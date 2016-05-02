import {NALUAsm} from '../rtp_payload/h264/NALUAsm';
import {NALU} from '../rtp_payload/h264/NALU';
import {ExpGolomb} from '../util/exp-golomb';
import {base64ToArrayBuffer} from '../util/binary';
import {BaseRemuxer} from './base';
import {MSE} from '../video_presenters/mse';
import {Log} from 'bp_logger';
// TODO: asm.js
export class H264TrackConverter extends BaseRemuxer {

    constructor(track) {
        super(track);
        this.codecstring=MSE.CODEC_AVC_BASELINE;

        this.units=[];
        this._initDTS = undefined;
        this.nextAvcDts = undefined;
        
        this.naluasm = new NALUAsm();
        this.readyToDecode = false;

        this.firstDTS=0;
        this.firstPTS=0;
        this.lastDTS=undefined;


        this.mp4track={
            id:BaseRemuxer.getTrackID(),
            type: 'video',
            nbNalu: 0,
            fragmented:true,
            sps:'',
            pps:'',
            width:0,
            height:0,
            samples: []
        };

        if (track.fmtp['sprop-parameter-sets']) {
            let sps_pps = track.fmtp['sprop-parameter-sets'].split(',');
            this.mp4track.pps=[new Uint8Array(base64ToArrayBuffer(sps_pps[1]))];
            this.parseTrackSPS(base64ToArrayBuffer(sps_pps[0]));
        }

        this.timeOffset = 0;
    }

    parseTrackSPS(sps) {
        var expGolombDecoder = new ExpGolomb(new Uint8Array(sps));
        var config = expGolombDecoder.readSPS();

        this.mp4track.width = config.width;
        this.mp4track.height = config.height;
        this.mp4track.sps = [new Uint8Array(sps)];
        this.mp4track.timescale = this.timescale;
        this.mp4track.duration = this.timescale;
        var codecarray = new DataView(sps,1,4);
        this.codecstring = 'avc1.';
        for (let i = 0; i < 3; i++) {
            var h = codecarray.getUint8(i).toString(16);
            if (h.length < 2) {
                h = '0' + h;
            }
            this.codecstring += h;
        }
        this.mp4track.codec = this.codecstring;
    }

    remux(rtpPacket) {
        if (!super.remux.call(this, rtpPacket)) return;

        let nalu = this.naluasm.onRTPPacket(rtpPacket);
        if (nalu) {
            let push = false;

            switch (nalu.type()) {
                case NALU.NDR:
                    if (this.readyToDecode) {
                        push=true;
                    }
                    break;
                case NALU.IDR:
                    if (!this.readyToDecode) {
                        if (this.mp4track.pps && this.mp4track.sps) {
                            push = true;
                            this.readyToDecode = true;
                            // let init = MP4.initSegment([this.mp4_vtrack, this.mp4track]);
                            // this.mse.feed(init);
                            // this.mse.play();
                            if (this._initDTS === undefined) {
                                this._initPTS = this.msToScaled(nalu.timestamp);
                                this._initDTS = this.msToScaled(nalu.timestamp);
                            }
                        }
                    } else {
                        push = true;
                        // this.flush = true;
                    }
                    break;
                case NALU.PPS:
                    if (!this.mp4track.pps) {
                        this.mp4track.pps = [new Uint8Array(nalu.data)];
                    }
                    break;
                case NALU.SPS:
                    if(!this.mp4track.sps) {
                        this.parseTrackSPS(nalu.data);
                    }
                    break;
                default: push = false;

            }

            // TODO: update sps & pps
            if (this.readyToDecode) {
                // TODO: mux it

                if (push) {
                    this.units.push(nalu);
                }
            }
        }
    }
    getPayload() {
            this.mp4track.len = 0;
            this.mp4track.nbNalu = 0;
            for (let unit of this.units) {
                this.mp4track.samples.push({
                    units: {
                        units: [unit],
                        length: unit.getSize()
                    },
                    pts: this.msToScaled(unit.timestamp),
                    dts: this.msToScaled(unit.timestamp),
                    key: unit.type() == NALU.IDR
                });
                this.mp4track.len+=unit.getSize();
                this.mp4track.nbNalu+=1;
            }

            let payload = new Uint8Array(this.mp4track.len);
            let offset = 0;
            let samples=[];

            this.mp4track.samples.sort(function(a, b) {
                return (a.pts-b.pts);
            });

            let ptsnorm, dtsnorm, sampleDuration=0 ,mp4Sample, lastDTS;
            while (this.mp4track.samples.length) {
                let avcSample = this.mp4track.samples.shift();
                let mp4SampleLength = 0;
                // convert NALU bitstream to MP4 format (prepend NALU with size field)
                while (avcSample.units.units.length) {
                    let unit = avcSample.units.units.shift();
                    let unit_data = unit.getData();
                    payload.set(unit_data, offset);
                    offset += unit_data.byteLength;
                    mp4SampleLength += unit_data.byteLength;
                }
                let pts = avcSample.pts - this._initPTS;
                let dts = avcSample.dts - this._initDTS;
                // ensure DTS is not bigger than PTS
                dts = Math.min(pts,dts);
                //Log.debug(`Video/PTS/DTS:${Math.round(pts/RTSPStream.SCALE_FACTOR)}/${Math.round(dts/RTSPStream.SCALE_FACTOR)}`);
                // if not first AVC sample of video track, normalize PTS/DTS with previous sample value
                // and ensure that sample duration is positive
                if (lastDTS !== undefined) {
                    ptsnorm = BaseRemuxer.PTSNormalize(pts, lastDTS);
                    dtsnorm = BaseRemuxer.PTSNormalize(dts, lastDTS);
                    sampleDuration = (dtsnorm - lastDTS) /*/ RTSPStream.SCALE_FACTOR*/;
                    //Log.debug(`Sample duration: ${sampleDuration}`);
                    if (sampleDuration <= 0) {
                        Log.log(`invalid sample duration at PTS/DTS: ${avcSample.pts}/${avcSample.dts}|dts norm: ${dtsnorm}|lastDTS: ${lastDTS}:${sampleDuration}`);
                        sampleDuration = 1;
                        // FIXME: skip frame?
                    }
                    //mp4Sample.duration = sampleDuration;
                } else {
                    var nextAvcDts = this.nextAvcDts, delta;
                    // first AVC sample of video track, normalize PTS/DTS
                    ptsnorm = BaseRemuxer.PTSNormalize(pts, nextAvcDts);
                    dtsnorm = BaseRemuxer.PTSNormalize(dts, nextAvcDts);
                    if (nextAvcDts) {
                        delta = Math.round((dtsnorm - nextAvcDts) /*/ RTSPStream.SCALE_FACTOR*/);
                        // if fragment are contiguous, or delta less than 600ms, ensure there is no overlap/hole between fragments
                        if (/*contiguous ||*/ Math.abs(delta) < 600) {
                            if (delta) {
                                if (delta > 1) {
                                    Log.log(`AVC:${delta} ms hole between fragments detected,filling it`);
                                } else if (delta < -1) {
                                    Log.log(`AVC:${(-delta)} ms overlapping between fragments detected`);
                                }
                                // set DTS to next DTS
                                dtsnorm = nextAvcDts;
                                // offset PTS as well, ensure that PTS is smaller or equal than new DTS
                                ptsnorm = Math.max(ptsnorm - delta, dtsnorm);
                                Log.log(`Video/PTS/DTS adjusted: ${ptsnorm}/${dtsnorm},delta:${delta}`);
                            }
                        }
                    }
                    // remember first PTS of our avcSamples, ensure value is positive
                    this.firstPTS = Math.max(0, ptsnorm);
                    this.firstDTS = Math.max(0, dtsnorm);
                    sampleDuration = 1;
                }
                //console.log('PTS/DTS/initDTS/normPTS/normDTS/relative PTS : ${avcSample.pts}/${avcSample.dts}/${this._initDTS}/${ptsnorm}/${dtsnorm}/${(avcSample.pts/4294967296).toFixed(3)}');
                mp4Sample = {
                    size: mp4SampleLength,
                    duration: sampleDuration,
                    cts: (ptsnorm - dtsnorm) /*/ RTSPStream.SCALE_FACTOR*/,
                    flags: {
                        isLeading: 0,
                        isDependedOn: 0,
                        hasRedundancy: 0,
                        degradPrio: 0
                    }
                };
                let flags = mp4Sample.flags;
                if (avcSample.key === true) {
                    // the current sample is a key frame
                    flags.dependsOn = 2;
                    flags.isNonSync = 0;
                } else {
                    flags.dependsOn = 1;
                    flags.isNonSync = 1;
                }
                samples.push(mp4Sample);
                lastDTS = dtsnorm;
            }

            var lastSampleDuration = 0;
            if (samples.length >= 2) {
                lastSampleDuration = samples[samples.length - 2].duration;
                samples[0].duration = lastSampleDuration;
            }
            // next AVC sample DTS should be equal to last sample DTS + last sample duration
            this.nextAvcDts = dtsnorm + lastSampleDuration /** RTSPStream.SCALE_FACTOR*/;

            if(samples.length && navigator.userAgent.toLowerCase().indexOf('chrome') > -1) {
                let flags = samples[0].flags;
                // chrome workaround, mark first sample as being a Random Access Point to avoid sourcebuffer append issue
                // https://code.google.com/p/chromium/issues/detail?id=229412
                flags.dependsOn = 2;
                flags.isNonSync = 0;
            }

            this.mp4track.samples = samples;
            if (samples.length) {
                this.mp4track.lastDuration = (this.lastDTS||0) + samples[samples.length - 1].duration;
            } else {
                this.mp4track.lastDuration = 0;
            }
            // let moof = MP4.moof(this.seq, firstDTS, this.mp4_vtrack);
            // this.mp4_vtrack.samples = [];
            // this.units = [];
            //
            // let mdat = MP4.mdat(payload);
            // this.mse.feed(moof);
            // this.mse.feed(mdat);
            return payload;
    }
    flush() {
        this.seq++;
        this.mp4track.samples = [];
        this.units = [];
    }
}
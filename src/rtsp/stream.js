import {Log} from 'bp_logger';
import {RTSPClientSM as RTSPClient}  from './client';
import {RTP} from './rtp';
import {Url} from './../util/url';
import {NALUAsm} from './../h264/NALUAsm';
import {NALU} from './../h264/NALU';
import {RTPError} from './connection';
import {MP4} from './../iso-bmff/mp4-generator';
import {ExpGolomb} from './../h264/exp-golomb';
import {MSE} from './../video_presenters/mse';

function _base64ToArrayBuffer(base64) {
    var binary_string =  window.atob(base64);
    var len = binary_string.length;
    var bytes = new Uint8Array( len );
    for (var i = 0; i < len; i++)        {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}
function concatenate(resultConstructor, ...arrays) {
    let totalLength = 0;
    for (let arr of arrays) {
        totalLength += arr.length;
    }
    let result = new resultConstructor(totalLength);
    let offset = 0;
    for (let arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

export class RTSPStream {

    static SCALE_FACTOR = 90;//4;
    static TIMESCALE = 90000;

    constructor(client, track) {
        this.state = null;
        this.flush = false;
        this.client = client;
        this.track = track;
        this.codecIsSet = false;
        this.mp4track={
            id:1,
            type: 'video',
            nbNalu: 0,
            fragmented:true,
            samples: []
        };
        this.units=[];
        this._initDTS = undefined;
        this.nextAvcDts = undefined;

        this.keepaliveType = '';
        this.keepaliveData = {};
        this.keepaliveInterval = null;

        let vid_sdp = this.client.sdp.media.video;
        RTSPStream.TIMESCALE = Number(vid_sdp.rtpmap[""+vid_sdp.fmt[0]].clock);
        this.naluasm = new NALUAsm();
        this.readyToDecode = false;
        this.seq = 0;

        if (this.client.sdp.media.video.fmtp['sprop-parameter-sets']) {
            let sps_pps = this.client.sdp.media.video.fmtp['sprop-parameter-sets'].split(',');
            this.mp4track.pps=[new Uint8Array(_base64ToArrayBuffer(sps_pps[1]))];
            this.parseTrackSPS(_base64ToArrayBuffer(sps_pps[0]));
        }

        this.timeOffset = 0;
    }

    sendKeepalive() {
        return this.client.connection.sendRequest(this.keepaliveType, this.client.connection.url, this.keepaliveData).then((data)=>{
        });
    }

    start() {
        return this.sendSetup().then(this.sendPlay.bind(this));
    }

    getSetupURL(track) {
        var sessionBlock = this.client.sdp.getSessionBlock();
        if (Url.isAbsolute(track.control)) {
            return track.control;
        } else if (Url.isAbsolute(`${sessionBlock.control}${track.control}`)) {
            return `${sessionBlock.control}${track.control}`;
        } else if (Url.isAbsolute(`${this.client.contentBase}${track.control}`)) {
            /* Should probably check session level control before this */
            return `${this.client.contentBase}${track.control}`;
        }

        Log.error('Can\'t determine track URL from ' +
            'block.control:' + track.control + ', ' +
            'session.control:' + sessionBlock.control + ', and ' +
            'content-base:' + this.client.contentBase);
    }

    getControlURL() {
        let sessCtrl = this.client.sdp.getSessionBlock().control;
        if (Url.isAbsolute(sessCtrl)) {
            return sessCtrl;
        } else if (!sessCtrl || '*' === sessCtrl) {
            return this.client.contentBase;
        } else {
            return `${this.client.contentBase}${sessCtrl}`;
        }
    }

    sendSetup() {
        this.state = RTSPClient.STATE_SETUP;
        let interleavedChannels = this.client.interleaveChannelIndex++ + "-" + this.client.interleaveChannelIndex++;
        let params = {
            'Transport': `RTP/AVP/TCP;unicast;interleaved=${interleavedChannels}`,
            'Date': new Date().toUTCString()
        };
        if (this.client.session) {
            params['Session'] = this.client.session;
        }
        return this.client.connection.sendRequest('SETUP', this.getSetupURL(this.track), params).then((_data)=>{
            // TODO: stream-specific session
            this.client.session = _data.headers['session'];
            /*if (!/RTP\/AVP\/TCP;unicast;interleaved=/.test(_data.headers["transport"])) {
                // TODO: disconnect stream and notify client
                throw new Error("Connection broken");
            }*/
        });
    }

    attachMSE(mse) {
        if (this.mse) {
            this.detachMSE()
        }
        this.mse = mse;
        if (!this.codecIsSet && this.mp4track.codec) {
            this.mse.setCodec(`video/mp4; codecs="${this.mp4track.codec}"`);
        }
        this.mse.mediaSource.addEventListener('sourceended', ()=>{
            //this.client.connection.rtp.abort();
            this.sendTeardown();
        });
    }

    detachMSE() {
        this.mse = null;
    }

    sendPlay() {
        this.state = RTSPStream.STATE_PLAY;
        return this.client.connection.sendRequest('PLAY', this.getControlURL(this.track), {
            'Session': this.client.session
        }).then((_data)=>{
            try {
                let rtp_info = _data.headers["rtp-info"].split(';');
                this.timeOffset = Number(rtp_info[rtp_info.length - 1].split("=")[1]) / RTSPStream.SCALE_FACTOR;
            } catch (e) {
                this.timeOffset = new Date().getTime() / RTSPStream.SCALE_FACTOR;
            }
            this.state = RTSPClient.STATE_PLAYING;

            this.client.connection.backend.setRtpHandler(this.onRTP.bind(this));
            // TODO: move to worker
            this.keepaliveType = 'GET_PARAMETER';
            this.keepaliveData = {
                'Session': this.client.session
            };
            this.keepaliveInterval = setInterval(()=>{
                this.sendKeepalive();
            }, 30000);
        });
    }

    sendPause() {
        if (!this.client.supportCommand("PAUSE")) {
            return;
        }
        this.state = RTSPClient.STATE_PAUSE;
        return this.client.connection.sendRequest("PAUSE", this.getControlURL(this.track), {
            'Session': this.client.session
        }).then((_data)=>{
            this.state = RTSPClient.STATE_PAUSED;
        });
    }

    sendTeardown() {
        this.state = RTSPClient.STATE_TEARDOWN;
        return this.client.connection.sendRequest("TEARDOWN", this.getControlURL(this.track), {
            'Session': this.client.session
        }).then(()=> {
            Log.log('RTSPClient: STATE_TEARDOWN');
            clearInterval(this.keepaliveInterval);
            this.client.connection.disconnect();
        });
    }

    parseTrackSPS(sps) {
        var expGolombDecoder = new ExpGolomb(new Uint8Array(sps));
        var config = expGolombDecoder.readSPS();

        console.log(config);

        this.mp4track.width = config.width;
        this.mp4track.height = config.height;
        this.mp4track.sps = [new Uint8Array(sps)];
        this.mp4track.timescale = RTSPStream.TIMESCALE;
        this.mp4track.duration = RTSPStream.TIMESCALE;
        var codecarray = new DataView(sps,1,4);
        var codecstring = 'avc1.';
        for (let i = 0; i < 3; i++) {
            var h = codecarray.getUint8(i).toString(16);
            if (h.length < 2) {
                h = '0' + h;
            }
            codecstring += h;
        }
        this.mp4track.codec = codecstring;
        if (!MSE.isSupported([codecstring])) {
            throw new Error("codec is not supported");
        }
        if (this.mse && !this.codecIsSet) {
            this.mse.setCodec(`video/mp4; codecs="${this.mp4track.codec}"`);
            this.codecIsSet = true;
        }
        //console.log(this.mp4track);
    }

    _PTSNormalize(value, reference) {
        var offset;
        if (reference === undefined) {
            return value;
        }
        if (reference < value) {
            // - 2^33
            offset = -8589934592;
        } else {
            // + 2^33
            offset = 8589934592;
        }
        /* PTS is 33bit (from 0 to 2^33 -1)
         if diff between value and reference is bigger than half of the amplitude (2^32) then it means that
         PTS looping occured. fill the gap */
        while (Math.abs(value - reference) > 4294967296) {
            value += offset;
        }
        return value;
    }

    msToScaled(timestamp) {
        return (timestamp - this.timeOffset) * RTSPStream.SCALE_FACTOR
    }

    onRTP(_data) {
        let rtpPacket = new RTP(_data.packet, this.client.sdp);
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
                            let init = MP4.initSegment([this.mp4track]);
                            this.mse.feed(init);
                            this.mse.play();
                            if (this._initDTS === undefined) {
                                this._initPTS = this.msToScaled(nalu.timestamp);
                                this._initDTS = this.msToScaled(nalu.timestamp);
                            }
                        }
                    } else {
                        push = true;
                        this.flush = true;
                        this.seq++;
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
                if (this.flush) {
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

                    let lastDTS, firstDTS, firstPTS, ptsnorm, dtsnorm, sampleDuration=0 ,mp4Sample;
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
                            ptsnorm = this._PTSNormalize(pts, lastDTS);
                            dtsnorm = this._PTSNormalize(dts, lastDTS);
                            sampleDuration = (dtsnorm - lastDTS) /*/ RTSPStream.SCALE_FACTOR*/;
                            //Log.debug(`Sample duration: ${sampleDuration}`);
                            if (sampleDuration <= 0) {
                                Log.log(`invalid sample duration at PTS/DTS: ${avcSample.pts}/${avcSample.dts}:${sampleDuration}`);
                                sampleDuration = 1;
                            }
                            //mp4Sample.duration = sampleDuration;
                        } else {
                            var nextAvcDts = this.nextAvcDts, delta;
                            // first AVC sample of video track, normalize PTS/DTS
                            ptsnorm = this._PTSNormalize(pts, nextAvcDts);
                            dtsnorm = this._PTSNormalize(dts, nextAvcDts);
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
                            firstPTS = Math.max(0, ptsnorm);
                            firstDTS = Math.max(0, dtsnorm);
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
                    let moof = MP4.moof(this.seq, firstDTS, this.mp4track);
                    this.mp4track.samples = [];
                    this.units = [];

                    let mdat = MP4.mdat(payload);
                    this.mse.feed(moof);
                    this.mse.feed(mdat);
                    this.flush = false;
                }

                if (push) {
                    this.units.push(nalu);
                }
            }
        }
    }
}

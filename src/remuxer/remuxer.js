import {MP4} from '../iso-bmff/mp4-generator';
import {AACTrackConverter} from './aac';
import {H264TrackConverter} from './h264';
import {MSE} from '../video_presenters/mse';
import {Log} from 'bp_logger';
import {EventEmitter} from 'bp_event';

export class Remuxer {
    static TrackConverters = {
        'H264':      H264TrackConverter,
        'MP4A-LATM': AACTrackConverter
    };

    constructor() {
        this.eventSource = new EventEmitter();
        this.initialized = false;
        this.initSegment = null;
        this.tracks = {};
        this.codecs = [];
        this.streams = {};
        this.enabled = false;
        this.mse_ready = true;
    }

    setTrack(track, stream) {
        let fmt = track.rtpmap[track.fmt[0]].name;
        this.streams[track.type] = stream;
        if (Remuxer.TrackConverters[fmt]){
            this.tracks[track.type] = new Remuxer.TrackConverters[fmt](track);
        } else {
            Log.warn(`${track.type} track is not attached cause there is no remuxer for ${fmt}`);
        }
    }

    setTimeOffset(timeOffset, track) {
        if (this.tracks[track.type]) {
            this.tracks[track.type].timeOffset = timeOffset/this.tracks[track.type].scaleFactor;
        }
    }

    init() {
        let tracks = [];
        this.codecs = [];
        for (let track_type in this.tracks) {
            let track = this.tracks[track_type];
            if (!MSE.isSupported([track.codecstring])) {
                throw new Error(`${track.mp4track.type} codec ${track.codecstring} is not supported`);
            }
            tracks.push(track.mp4track);
            this.codecs.push(track.codecstring);
        }
        this.initSegment = MP4.initSegment(tracks, 90000, 90000);
        this.initialized = true;
        if (this.mse) {
            this.initMSE();
        }
    }

    initMSE() {
        if (MSE.isSupported(this.codecs)) {
            this.mse.setCodec(`video/mp4; codecs="${this.codecs.join(', ')}"`).then(()=>{
                this.mse.feed(this.initSegment);
                this.mse.play();
                this.enabled = true;
            });
        } else {
            throw new Error('Codecs are not supported');
        }
    }

    attachMSE(mse) {
        if (this.mse) {
            this.detachMSE()
        }
        this.mse = mse;
        this.mse.eventSource.addEventListener('error', ()=> {
            this.sendTeardown();
        });
        this.mse.eventSource.addEventListener('sourceclose', ()=> {
            this.sendTeardown();
        });

        if (this.initialized) {
            this.initMSE();
        }
    }

    sendTeardown() {
        // TODO: stop flusher
        this.mse_ready = false;
        this.enabled = false;
        this.initialized = false;
        this.mse.clear();
        for (let track_type in this.streams) {
            this.streams[track_type].sendTeardown();
        }
        this.eventSource.dispatchEvent('stopped');
    }

    detachMSE() {
        this.mse = null;
    }

    flush() {
        if (!this.mse_ready) return;
        if (!this.initialized) {
            for (let track_type in this.tracks) {
                if (!this.tracks[track_type].readyToDecode) return;
            }
            try {
                this.init();
            } catch (e) {
                this.eventSource.dispatchEvent('error', {'reason': e.message});
                Log.error(e.message);
                this.sendTeardown();
                return;
            }
        }
        if (!this.enabled) return;
        if (this.mse ) {
            for (let track_type in this.tracks) {
                let track = this.tracks[track_type];
                let pay = track.getPayload();
                if (pay && pay.byteLength) {
                    let mdat = MP4.mdat(pay);    // TODO: order independent implementation
                    let moof = MP4.moof(track.seq, track.firstDTS, track.mp4track);
                    // console.log(`${track_type}: ${track.firstDTS}`);
                    this.mse.feed(moof);
                    this.mse.feed(mdat);
                    track.flush();
                }
            }
        } else {
            for (let track_type in this.tracks) {
                let track = this.tracks[track_type];
                track.flush();
            }
        }
    }

    feedRTP(rtpPacket) {
        let track = this.tracks[rtpPacket.media.type];
        if (track) {
            track.remux(rtpPacket);
        }
    }
}
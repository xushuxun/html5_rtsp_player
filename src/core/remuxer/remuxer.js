import {MP4} from '../iso-bmff/mp4-generator';
import {AACRemuxer} from './aac';
import {H264Remuxer} from './h264';
import {MSE} from '../presentation/mse';
import {EventEmitter} from 'bp_event';
import {PayloadType} from "../defs";

import {getTagged} from "bp_logger";

const LOG_TAG = "remuxer";
const Log = getTagged(LOG_TAG);

export class Remuxer {
    static get TrackConverters() {return {
        [PayloadType.H264]: H264Remuxer,
        [PayloadType.AAC]:  AACRemuxer
    }};

    static get TrackScaleFactor() {return {
        [PayloadType.H264]: 1,//4,
        [PayloadType.AAC]:  0
    }};

    static get TrackTimescale() {return {
        [PayloadType.H264]: 90000,//22500,
        [PayloadType.AAC]:  0
    }};

    constructor(mediaElement) {
        this.mse = new MSE([mediaElement]);
        this.eventSource = new EventEmitter();
        this.mse_ready = true;

        this.reset();

        this.errorListener = this.mseClose.bind(this);
        this.closeListener = this.mseClose.bind(this);
        this.samplesListener = this.onSamples.bind(this);
        this.audioConfigListener = this.onAudioConfig.bind(this);

        this.mse.eventSource.addEventListener('error', this.errorListener);
        this.mse.eventSource.addEventListener('sourceclose', this.closeListener);
        
        this.eventSource.addEventListener('ready', this.init.bind(this));
    }

    reset() {
        this.tracks = {};
        this.initialized = false;
        this.initSegments = {};
        this.codecs = [];
        this.streams = {};
        this.enabled = false;
    }

    destroy() {
        this.mse.destroy();
        this.mse = null;

        this.detachClient();

        this.eventSource.destroy();
    }

    onTracks(tracks) {
        Log.debug(tracks.detail);
        // store available track types
        for (let track of tracks.detail) {
            this.tracks[track.type] = new Remuxer.TrackConverters[track.type](Remuxer.TrackTimescale[track.type], Remuxer.TrackScaleFactor[track.type], track.params);
            if (track.offset) {
                this.tracks[track.type].timeOffset = track.offset;
            }
            if (track.duration) {
                this.tracks[track.type].mp4track.duration = track.duration*(this.tracks[track.type].timescale || Remuxer.TrackTimescale[track.type]);
                this.tracks[track.type].duration = track.duration;
            } else {
                this.tracks[track.type].duration = 1;
            }

            // this.tracks[track.type].duration
        }
        this.mse.setLive(!this.client.seekable);
    }

    setTimeOffset(timeOffset, track) {
        if (this.tracks[track.type]) {
            this.tracks[track.type].timeOffset = timeOffset;///this.tracks[track.type].scaleFactor;
        }
    }

    init() {
        let tracks = [];
        this.codecs = [];
        let initmse = [];
        let initPts = Infinity;
        let initDts = Infinity;
        for (let track_type in this.tracks) {
            let track = this.tracks[track_type];
            if (!MSE.isSupported([track.mp4track.codec])) {
                throw new Error(`${track.mp4track.type} codec ${track.mp4track.codec} is not supported`);
            }
            tracks.push(track.mp4track);
            this.codecs.push(track.mp4track.codec);
            track.init(initPts, initDts/*, false*/);
            // initPts = Math.min(track.initPTS, initPts);
            // initDts = Math.min(track.initDTS, initDts);
        }

        for (let track_type in this.tracks) {
            let track = this.tracks[track_type];
            //track.init(initPts, initDts);
            this.initSegments[track_type] = MP4.initSegment([track.mp4track], track.duration*track.timescale, track.timescale);
            initmse.push(this.initMSE(track_type, track.mp4track.codec));
        }
        this.initialized = true;
        Promise.all(initmse).then(()=>{
            this.mse.play();
            this.enabled = true;
        });
        
    }

    initMSE(track_type, codec) {
        if (MSE.isSupported(this.codecs)) {
            return this.mse.setCodec(track_type, `${PayloadType.map[track_type]}/mp4; codecs="${codec}"`).then(()=>{
                this.mse.feed(track_type, this.initSegments[track_type]);
                // this.mse.play();
                // this.enabled = true;
            });
        } else {
            throw new Error('Codecs are not supported');
        }
    }

    mseClose() {
        // this.mse.clear();
        this.eventSource.dispatchEvent('stopped');
    }

    flush() {
        this.onSamples();
        if (!this.initialized) {
            if (Object.keys(this.tracks).length) {
                for (let track_type in this.tracks) {
                    if (!this.tracks[track_type].readyToDecode || !this.tracks[track_type].samples.length) return;
                }
                this.eventSource.dispatchEvent('ready');
            }
        } else {
            for (let track_type in this.tracks) {
                let track = this.tracks[track_type];
                let pay = track.getPayload();
                if (pay && pay.byteLength) {
                    this.mse.feed(track_type, [MP4.moof(track.seq, track.scaled(track.firstDTS), track.mp4track), MP4.mdat(pay)]);
                    track.flush();
                }
            }
        }
    }

    onSamples(ev) {
        // TODO: check format
        // let data = ev.detail;
        // if (this.tracks[data.pay] && this.client.sampleQueues[data.pay].length) {
            // console.log(`video ${data.units[0].dts}`);
        for (let qidx in this.client.sampleQueues) {
            let queue = this.client.sampleQueues[qidx];
            while (queue.length) {
                let units = queue.shift();
                for (let chunk of units) {
                    this.tracks[qidx].remux(chunk);
                }
            }
        }
        // }
    }

    onAudioConfig(ev) {
        if (this.tracks[ev.detail.pay]) {
            this.tracks[ev.detail.pay].setConfig(ev.detail.config);
        }
    }

    attachClient(client) {
        this.detachClient();
        this.client = client;
        this.client.eventSource.addEventListener('samples', this.samplesListener);
        this.client.eventSource.addEventListener('audio_config', this.audioConfigListener);
        this.client.eventSource.addEventListener('tracks', this.onTracks.bind(this));
        this.client.eventSource.addEventListener('flush', this.flush.bind(this));
        this.client.eventSource.addEventListener('clear', ()=>{
            this.reset();
            this.mse.clear().then(()=>{
                this.mse.play();
            });
        });
    }

    detachClient() {
        if (this.client) {
            this.client.eventSource.removeEventListener('samples', this.samplesListener);
            this.client.eventSource.removeEventListener('audio_config', this.audioConfigListener);
            // TODO: clear other listeners
            // this.client.eventSource.removeEventListener('clear');
            this.client = null;
        }
    }
}
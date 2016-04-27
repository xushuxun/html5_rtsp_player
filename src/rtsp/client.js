import {StateMachine} from 'bp_statemachine';
import {Log} from 'bp_logger';
import {MSE} from './../video_presenters/mse';
import {SDPParser} from './sdp';
import {RTSPStream} from './stream';
import {Remuxer} from '../remuxer/remuxer';
import {RTP} from './rtp';
import {RTPError} from './connection';


export class RTSPClientSM extends StateMachine {
    static USER_AGENT = 'SFRtsp 0.2';
    static STATE_INITIAL  = 1 << 0;
    static STATE_OPTIONS  = 1 << 1;
    static STATE_DESCRIBE = 1 << 2;
    static STATE_SETUP    = 1 << 3;
    static STATE_STREAMS  = 1 << 4;
    static STATE_TEARDOWN = 1 << 5;

    constructor(connection, _mediaElement) {
        super();

        this.connection = connection;
        this.mse = new MSE([_mediaElement]);
        this.remuxer = null;

        this.reset();

        this.addState(RTSPClientSM.STATE_INITIAL,{
        }).addState(RTSPClientSM.STATE_OPTIONS, {
            activate: this.sendOptions,
            finishTransition: this.onOptions
        }).addState(RTSPClientSM.STATE_DESCRIBE, {
            activate: this.sendDescribe,
            finishTransition: this.onDescribe
        }).addState(RTSPClientSM.STATE_SETUP, {
            activate: this.sendSetup,
            finishTransition: this.onSetup
        }).addState(RTSPClientSM.STATE_STREAMS, {

        }).addState(RTSPClientSM.STATE_TEARDOWN, {
            activate: ()=>{
                this.started = false;
                let promises = [];
                for (let stream in this.streams) {
                    promises.push(this.streams[stream].sendTeardown())
                }
                return Promise.all(promises);
            },
            finishTransition: ()=>{
                return this.transitionTo(RTSPClientSM.STATE_INITIAL)
            }
        }).addTransition(RTSPClientSM.STATE_INITIAL, RTSPClientSM.STATE_OPTIONS)
            .addTransition(RTSPClientSM.STATE_OPTIONS, RTSPClientSM.STATE_DESCRIBE)
            .addTransition(RTSPClientSM.STATE_DESCRIBE, RTSPClientSM.STATE_SETUP)
            .addTransition(RTSPClientSM.STATE_SETUP, RTSPClientSM.STATE_STREAMS)
            .addTransition(RTSPClientSM.STATE_STREAMS, RTSPClientSM.STATE_TEARDOWN)
            .addTransition(RTSPClientSM.STATE_TEARDOWN, RTSPClientSM.STATE_INITIAL)
            .addTransition(RTSPClientSM.STATE_STREAMS, RTSPClientSM.STATE_TEARDOWN)
            .addTransition(RTSPClientSM.STATE_SETUP, RTSPClientSM.STATE_TEARDOWN)
            .addTransition(RTSPClientSM.STATE_DESCRIBE, RTSPClientSM.STATE_TEARDOWN)
            .addTransition(RTSPClientSM.STATE_OPTIONS, RTSPClientSM.STATE_TEARDOWN);

        this.transitionTo(RTSPClientSM.STATE_INITIAL);

        this.shouldReconnect = false;
        this.connection.eventSource.addEventListener('connected', ()=>{
            if (this.shouldReconnect) {
                this.reconnect();
            }
        });
        this.connection.eventSource.addEventListener('disconnected', ()=>{
            if (this.started) {
                this.shouldReconnect = true;
            }
        });
    }

    stop() {
        this.started = false;
        this.shouldReconnect = false;
        this.mse = null;
    }

    reset() {
        this.methods = [];
        this.tracks = [];
        this.streams={};
        this.contentBase = "";
        this.state = null;
        this.sdp = null;
        this.interleaveChannelIndex = 0;
        this.session = null;
        this.vtrack_idx = -1;
        this.atrack_idx = -1;
        this.stopStreamFlush();

        this.mse.reset();
    }

    reconnect() {
        this.reset();
        if (this.currentState.name != RTSPClientSM.STATE_INITIAL) {
            this.transitionTo(RTSPClientSM.STATE_TEARDOWN).then(()=> {
                this.transitionTo(RTSPClientSM.STATE_OPTIONS);
            });
        } else {
            this.transitionTo(RTSPClientSM.STATE_OPTIONS);
        }
    }

    supports(method) {
        return this.methods.includes(method)
    }

    sendOptions() {
        this.reset();
        this.started = true;
        this.connection.cSeq = 0;
        return this.connection.sendRequest('OPTIONS', '*', {});
    }

    onOptions(data) {
        this.methods = data.headers['public'].split(',').map((e)=>e.trim());
        this.transitionTo(RTSPClientSM.STATE_DESCRIBE);
    }

    sendDescribe() {
        return this.connection.sendRequest('DESCRIBE', this.connection.url, {
            'Accept': 'application/sdp'
        }).then((data)=>{
            this.sdp = new SDPParser();
            return this.sdp.parse(data.body).catch(()=>{
                throw new Error("Failed to parse SDP");
            }).then(()=>{return data;});
        });
    }

    onDescribe(data) {
        this.contentBase = data.headers['content-base'];
        this.tracks = this.sdp.getMediaBlockList();
        Log.log('SDP contained ' + this.tracks.length + ' track(s). Calling SETUP for each.');

        if (data.headers['session']) {
            this.session = data.headers['session'];
        }

        if (!this.tracks.length) {
            throw new Error("No tracks in SDP");
        }

        this.transitionTo(RTSPClientSM.STATE_SETUP);
    }

    sendSetup() {
        let streams=[];
        this.remuxer = new Remuxer();
        this.remuxer.attachMSE(this.mse);
        this.remuxer.eventSource.addEventListener('stop', this.stopStreamFlush.bind(this));
        this.remuxer.eventSource.addEventListener('error', (e)=>{
            alert(e.detail.reason);
            this.stopStreamFlush();
        });

        // TODO: select first video and first audio tracks
        for (let track_type of this.tracks) {
            Log.log("setup track: "+track_type);
            // if (track_type=='audio') continue;
            // if (track_type=='video') continue;
            let track = this.sdp.getMediaBlock(track_type);
            this.streams[track_type] = new RTSPStream(this, track);
            this.remuxer.setTrack(track, this.streams[track_type]);
            let playPromise = this.streams[track_type].start();
            playPromise.then(({track, data})=>{
                let timeOffset = 0;
                try {
                    let rtp_info = data.headers["rtp-info"].split(';');
                    timeOffset = Number(rtp_info[rtp_info.length - 1].split("=")[1]) ;
                } catch (e) {
                    timeOffset = new Date().getTime();
                }
                this.remuxer.setTimeOffset(timeOffset, track);
            });
            streams.push(playPromise);
        }
        this.startStreamFlush();
        this.connection.backend.setRtpHandler(this.onRTP.bind(this));
        return Promise.all(streams);
    }

    onSetup() {
        this.transitionTo(RTSPClientSM.STATE_STREAMS);
    }

    startStreamFlush() {
        this.flushInterval = setInterval(()=>{
            if (this.remuxer) this.remuxer.flush();
        }, 200); // TODO: configurable
    }

    stopStreamFlush() {
        clearInterval(this.flushInterval);
    }

    onRTP(_data) {
        // console.log(rtpPacket.media.type);
        this.remuxer.feedRTP(new RTP(_data.packet, this.sdp));
    }
}
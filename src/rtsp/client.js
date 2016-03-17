import {StateMachine} from 'bp_statemachine';
import {Log} from 'bp_logger';
import {MSE} from './../video_presenters/mse';
import {SDPParser} from './sdp';
import {RTSPStream} from './stream';
import {CustomEventListener} from 'bp_event';

export class RTSPClientSM extends StateMachine {
    static USER_AGENT = 'SFRtsp 0.1';
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
        this.eventListener = new CustomEventListener();
        this.eventListener.observe(this.connection.eventSource);
        this.eventListener.on('connected', ()=>{
            if (this.shouldReconnect) {
                this.reconnect();
            }
        });
        this.eventListener.on('disconnected', ()=>{
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
        for (let track of this.tracks) {
            Log.log("setup track: "+track);
            this.streams[track] = new RTSPStream(this, this.sdp.getMediaBlock(track));
            streams.push(this.streams[track].start());
            // TODO: mix tracks?
            this.streams[track].attachMSE(this.mse);
        }
        return Promise.all(streams);
    }

    onSetup() {
        this.transitionTo(RTSPClientSM.STATE_STREAMS);
    }
}
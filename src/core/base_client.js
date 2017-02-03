import {Log} from 'bp_logger';
import {EventEmitter} from 'bp_event';

export class BaseClient {
    constructor(transport, options={flush: 100}) {
        this.options = options;
        this.eventSource = new EventEmitter();

        Object.defineProperties(this, {
            sourceUrl: {value: null, writable: true},   // TODO: getter with validator
            paused: {value: true, writable: true},
            seekable: {value: false, writable: true},
            connected: {value: false, writable: true}
        });

        this._onData = ()=>{
            if (this.connected) {
                while (this.transport.dataQueue.length) {
                    this.onData(this.transport.dataQueue.pop());
                }
            }
        };
        this._onConnect = this.onConnected.bind(this);
        this._onDisconnect = this.onDisconnected.bind(this);
        this.attachTransport(transport);
    }

    static streamType() {
        return null;    
    }
    
    destroy() {
        this.detachTransport();
    }

    attachTransport(transport) {
        this.detachTransport();
        this.transport = transport;
        this.transport.eventSource.addEventListener('data', this._onData);
        this.transport.eventSource.addEventListener('connected', this._onConnect);
        this.transport.eventSource.addEventListener('disconnected', this._onDisconnect);
    }

    detachTransport() {
        if (this.transport) {
            this.transport.eventSource.removeEventListener('data', this._onData);
            this.transport.eventSource.removeEventListener('connected', this._onConnect);
            this.transport.eventSource.removeEventListener('disconnected', this._onDisconnect);
        }
    }

    start() {
        Log.log('Client started');
        this.paused = false;
        // this.startStreamFlush();
    }

    stop() {
        Log.log('Client paused');
        this.paused = true;
        // this.stopStreamFlush();
    }

    seek(timeOffset) {

    }

    setSource(source) {
        this.stop();
        this.endpoint = source;
        this.sourceUrl = source.urlpath;
    }

    startStreamFlush() {
        this.flushInterval = setInterval(()=>{
            if (!this.paused) {
                this.eventSource.dispatchEvent('flush');
            }
        }, this.options.flush);
    }

    stopStreamFlush() {
        clearInterval(this.flushInterval);
    }

    onData(data) {

    }

    onConnected() {
        if (!this.seekable) {
            this.transport.dataQueue = [];
            this.eventSource.dispatchEvent('clear');
        }
        this.connected = true;
    }

    onDisconnected() {
        this.connected = false;
    }
}
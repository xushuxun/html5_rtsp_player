import {Log} from 'bp_logger';
export class MSE {
    static CODEC_AVC_BASELINE = "avc1.42E01E";
    static CODEC_AVC_MAIN = "avc1.4D401E";
    static CODEC_AVC_HIGH = "avc1.64001E";
    static CODEC_VP8 = "vp8";
    static CODEC_AAC = "mp4a.40.2";
    static CODEC_VORBIS = "vorbis";
    static CODEC_THEORA = "theora";

    static isSupported(codecs=[MSE.CODEC_AVC_BASELINE, MSE.CODEC_AAC]) {
        return (window.MediaSource && window.MediaSource.isTypeSupported(`video/mp4; codecs="${codecs.join(',')}"`));
    }

    constructor (players) {
        this.players = players;
        this.reset();
    }

    play() {
        this.players.forEach((video)=>{video.play();});
    }

    reset() {
        this.mediaSource = new MediaSource();
        this.players.forEach((video)=>{video.src = URL.createObjectURL(this.mediaSource)});
        this.mediaReady = new Promise((resolve, reject)=>{
            this.mediaSource.addEventListener('sourceopen', resolve);
        });
        this.queue = []
    }

    setCodec(mimeCodec) {
        this.mediaReady.then(()=>{

            // TODO: listen errors

            this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeCodec);

            this.sourceBuffer.addEventListener('updatestart', (e)=> {
            });

            this.sourceBuffer.addEventListener('updateend', (e)=> {
                if (this.queue.length) {
                    var data = this.queue.shift();
                    this.doAppend(data);
                }
            });

            this.sourceBuffer.addEventListener('error', (e)=> {
                Log.error(`error ${e}`);
                this.mediaSource.removeSourceBuffer(this.sourceBuffer);
            });

            this.sourceBuffer.addEventListener('abort', (e)=> {
                Log.error(`error ${e}`);
                this.mediaSource.removeSourceBuffer(this.sourceBuffer);
            });
        });
    }

    doAppend(data) {
        let err = this.players[0].error;
        if (err) {
            Log.error(`Error occured: ${err}`);
            try {
                this.mediaSource.endOfStream();
                this.players.forEach((video)=>{video.stop();});
            } catch (e){

            }
        } else {
            this.sourceBuffer.appendBuffer(data);
        }
    }

    feed(data) {
        if (this.sourceBuffer && !this.sourceBuffer.updating) {
            this.doAppend(data);
        } else {
            this.queue.push(data);
        }
    }
}
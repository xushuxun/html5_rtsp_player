import {NALU} from './NALU';
import {Log} from 'bp_logger';
// TODO: asm.js
export class NALUAsm {
    static get NALTYPE_FU_A() {return 28;}
    static get NALTYPE_FU_B() {return 29;}

    constructor() {
        this.nalu = null;
    }

    onNALUFragment(rawData, dts, pts) {

        var data = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);

        var nalhdr = data.getUint8(0);

        var nri = nalhdr & 0x60;
        var naltype = nalhdr & 0x1F;
        var nal_start_idx = 1;

        if (27 >= naltype && 0 < naltype) {
            /* This RTP package is a single NALU, dispatch and forget, 0 is undefined */
            return new NALU(naltype, nri, rawData.subarray(nal_start_idx), dts, pts);
            //return;
        }

        if (NALUAsm.NALTYPE_FU_A !== naltype && NALUAsm.NALTYPE_FU_B !== naltype) {
            /* 30 - 31 is undefined, ignore those (RFC3984). */
            Log.log('Undefined NAL unit, type: ' + naltype);
            return null;
        }
        nal_start_idx++;

        var nalfrag = data.getUint8(1);
        var nfstart = (nalfrag & 0x80) >>> 7;
        var nfend = (nalfrag & 0x40) >>> 6;
        var nftype = nalfrag & 0x1F;

        var nfdon = 0;
        if (NALUAsm.NALTYPE_FU_B === naltype) {
            nfdon = data.getUint16(2);
            nal_start_idx+=2;
        }

        if (null === this.nalu || nfstart) {
            if (!nfstart) {
                console.log('broken chunk (continuation of lost frame)');
                return null;
            }  // Ignore broken chunks

            /* Create a new NAL unit from multiple fragmented NAL units */
            this.nalu = new NALU(nftype, nri, rawData.subarray(nal_start_idx), dts, pts);
        } else {
            if (this.nalu.dts != dts) {
                // debugger;
                // Frames lost
                console.log('broken chunk (continuation of frame with other timestamp)');
                this.nalu = null;
                return null;
            }
            /* We've already created the NAL unit, append current data */
            this.nalu.appendData(rawData.subarray(nal_start_idx));
        }

        if (1 === nfend) {
            let ret = this.nalu;
            this.nalu = null;
            return ret;
        }
    }
}

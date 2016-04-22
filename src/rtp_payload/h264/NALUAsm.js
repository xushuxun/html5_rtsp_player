import {NALU} from './NALU';
import {Log} from 'bp_logger';
// TODO: asm.js
export class NALUAsm {
    static NALTYPE_FU_A = 28;
    static NALTYPE_FU_B = 29;

    constructor() {
        this.nalu = null;
    }

    onRTPPacket(pkt/*RTPPacket*/) {
        let rawData = pkt.getPayload();
        if (!pkt.media) {
            return null;
        }
        let data = new DataView(rawData.buffer, rawData.byteOffset);

        let nalhdr = data.getUint8(0);

        let nri = nalhdr & 0x60;
        let naltype = nalhdr & 0x1F;
        let nal_start_idx = 1;

        if (27 >= naltype && 0 < naltype) {
            /* This RTP package is a single NALU, dispatch and forget, 0 is undefined */
            return new NALU(naltype, nri, rawData.subarray(nal_start_idx), pkt.getTimestampMS());
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

        if (NALUAsm.NALTYPE_FU_B === naltype) {
            var nfdon = data.getUint16(2);
            nal_start_idx++;
        }

        if (null === this.nalu) {
            /* Create a new NAL unit from multiple fragmented NAL units */
            this.nalu = new NALU(nftype, nri, rawData.subarray(nal_start_idx), pkt.getTimestampMS());
        } else {
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

import {appendByteArray} from '../util/bytearray';

export class NALU {

    static NDR = 1;
    static IDR = 5;
    static SEI = 6;
    static SPS = 7;
    static PPS = 8;

    static TYPES = {
        [NALU.IDR]: 'IDR',
        [NALU.SEI]: 'SEI',
        [NALU.SPS]: 'SPS',
        [NALU.PPS]: 'PPS',
        [NALU.NDR]: 'NDR'
    };

    static type(nalu) {
        if (nalu.ntype in NALU.TYPES) {
            return NALU.TYPES[nalu.ntype];
        } else {
            return 'UNKNOWN';
        }
    }

    constructor(ntype, nri, data, timestamp) {

      this.data      = data;
      this.ntype     = ntype;
      this.nri       = nri;
      this.timestamp = timestamp;
      this.bodySize  = data.byteLength;
    }

    appendData(idata) {
      this.data = appendByteArray(this.data, idata);
      this.bodySize = this.data.byteLength;
    }

    type() {
        return this.ntype;
    }

    getSize() {
      return 2 + 2 + 1 + this.data.byteLength;
    }

    getData() {
        let header = new ArrayBuffer(5);
        let view = new DataView(header);
        view.setUint32(0, this.data.byteLength+1);
        view.setUint8(4, (0x0 & 0x80) | (this.nri & 0x60) | (this.ntype & 0x1F));
        return new Uint8Array(appendByteArray(header, this.data));
    }
}

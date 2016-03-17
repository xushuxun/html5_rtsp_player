
export function appendByteArray(buffer1, buffer2) {
    var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
    tmp.set(new Uint8Array(buffer1), 0);
    tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
    return tmp.buffer;
}

export function appendByteArrayAsync(buffer1, buffer2) {
    return new Promise((resolve, reject)=>{
        let blob = new Blob([buffer1, buffer2]);
        let reader = new FileReader();
        reader.addEventListener("loadend", function() {
            resolve();
        });
        reader.readAsArrayBuffer(blob);
    });
}
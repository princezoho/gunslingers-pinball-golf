/* gifquick — tiny, dependency-free animated-GIF encoder.
   Uses a fixed 6x6x6 web-cube palette (216 colors) + 8-bit "uncompressed LZW"
   (periodic clear codes, no dictionary growth) so the bitstream is always valid
   without the subtle bugs of a real LZW encoder. Bayer-dithered quantization
   keeps gradients smooth. Good enough for short highlight clips; not size-optimal. */
(function (global) {
  'use strict';
  // 216-color web cube, padded to 256
  var PAL = (function () {
    var p = [], i;
    for (var r = 0; r < 6; r++) for (var g = 0; g < 6; g++) for (var b = 0; b < 6; b++) p.push([r * 51, g * 51, b * 51]);
    for (i = p.length; i < 256; i++) p.push([0, 0, 0]);
    return p;
  })();
  // 4x4 Bayer matrix, normalized to roughly +/-0.5 of a 51-step
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function q6(v, d) { var x = v + d; if (x < 0) x = 0; else if (x > 255) x = 255; return Math.round(x / 51); }
  // rgba Uint8ClampedArray (w*h*4) -> Uint8Array of palette indices (w*h)
  function quantize(rgba, w, h) {
    var out = new Uint8Array(w * h), i = 0, p = 0;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var d = (BAYER[((y & 3) << 2) | (x & 3)] / 16 - 0.5) * 38; // dither amplitude ~ 3/4 step
      var r = q6(rgba[p], d), g = q6(rgba[p + 1], d), b = q6(rgba[p + 2], d);
      out[i++] = r * 36 + g * 6 + b; p += 4;
    }
    return out;
  }
  // auto-growing byte buffer
  function Buf() { this.a = new Uint8Array(1 << 16); this.n = 0; }
  Buf.prototype.b = function (v) { if (this.n >= this.a.length) { var x = new Uint8Array(this.a.length * 2); x.set(this.a); this.a = x; } this.a[this.n++] = v & 255; };
  Buf.prototype.w = function (v) { this.b(v); this.b(v >> 8); };
  Buf.prototype.s = function (str) { for (var i = 0; i < str.length; i++) this.b(str.charCodeAt(i)); };
  Buf.prototype.out = function () { return this.a.subarray(0, this.n); };
  // "uncompressed" GIF LZW: clear, literals at width=9, re-clear before the decoder dict can grow past 9 bits
  function lzw(indices) {
    var CLEAR = 256, EOI = 257, WIDTH = 9;
    var bytes = [], cur = 0, nb = 0, count = 0;
    function emit(code) { cur |= (code << nb); nb += WIDTH; while (nb >= 8) { bytes.push(cur & 255); cur >>= 8; nb -= 8; } }
    emit(CLEAR);
    for (var i = 0; i < indices.length; i++) {
      emit(indices[i]); count++;
      if (count === 250) { emit(CLEAR); count = 0; }   // <253 adds keeps codes < 511 -> width stays 9
    }
    emit(EOI);
    if (nb > 0) bytes.push(cur & 255);
    return bytes;
  }
  // frames: array of Uint8Array index-streams (each w*h); returns Uint8Array of a complete GIF89a
  function encode(frames, w, h, delayCs) {
    var o = new Buf();
    o.s('GIF89a'); o.w(w); o.w(h);
    o.b(0xF7); o.b(0); o.b(0);                          // global color table 256, bg 0, aspect 0
    for (var i = 0; i < 256; i++) { var c = PAL[i]; o.b(c[0]); o.b(c[1]); o.b(c[2]); }
    o.b(0x21); o.b(0xFF); o.b(11); o.s('NETSCAPE2.0'); o.b(3); o.b(1); o.w(0); o.b(0);  // loop forever
    for (var f = 0; f < frames.length; f++) {
      o.b(0x21); o.b(0xF9); o.b(4); o.b(0); o.w(delayCs); o.b(0); o.b(0);              // graphic control: delay
      o.b(0x2C); o.w(0); o.w(0); o.w(w); o.w(h); o.b(0);                                // image descriptor
      o.b(8);                                                                          // LZW min code size
      var data = lzw(frames[f]), p = 0;
      while (p < data.length) { var n = Math.min(255, data.length - p); o.b(n); for (var k = 0; k < n; k++) o.b(data[p + k]); p += n; }
      o.b(0);                                                                          // block terminator
    }
    o.b(0x3B);                                                                         // trailer
    return o.out();
  }
  global.GIFQuick = { PAL: PAL, quantize: quantize, encode: encode };
})(typeof window !== 'undefined' ? window : this);

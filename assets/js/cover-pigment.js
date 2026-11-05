(function () {
  'use strict';

  if (!window.HTMLCanvasElement) return;

  var tiles = document.querySelectorAll('#catalog .cover-tile');
  if (!tiles.length) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Vortex radius as a fraction of the cover. Slow motion opens it up;
  // a fast drag keeps it tight. SPEED_FULL is cover-heights per second.
  var BRUSH_SLOW = 0.58;
  var BRUSH_FAST = 0.14;
  var SPEED_FULL = 1.15;
  var SIZE_GROW = 2.4;
  var SIZE_SHRINK = 6;
  // While the pointer stays put, the radius eases toward infinity and never arrives.
  var GROW_TAU = 2.8;
  var STILL_SPEED = 0.12;
  // How hard the photo twists at the cursor, in radians, and how far
  // samples reach outward so the picture spirals inward.
  var MAX_TURN = 2.6;
  var INWARD = 0.85;
  // Full blur radius at the cursor, as a fraction of the cover.
  // Mixed in by the swirl falloff, so the rim stays sharp.
  var BLUR_FRACTION = 0.085;
  // The vortex forms quickly and unwinds slowly once the pointer leaves it.
  var RISE = 7;
  var FALL = 0.72;
  var FOLLOW = 26;
  // Signed spin eases toward a new random direction as the pointer travels.
  var SPIN_FOLLOW = 8;
  var GRID = 72;
  // Full-cover CSS blur. Visible fraction 0 keeps this; fraction 1 clears it.
  var MAX_BLUR = 16;
  var INTRO_MS = 700;

  var hovering = null;
  var allStates = [];
  var pendingMounts = [];
  var mountScheduled = false;
  var resizeTimer = 0;

  function drawCover(ctx, img, w, h) {
    var iw = img.naturalWidth;
    var ih = img.naturalHeight;
    var scale = Math.max(w / iw, h / ih);
    var sw = w / scale;
    var sh = h / scale;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, w, h);
  }

  function smoother(u) {
    return u * u * u * (u * (u * 6 - 15) + 10);
  }

  // Inverse sample shift for one vortex around (cx, cy).
  // spin -1..1 picks clockwise or counterclockwise.
  // Easing the stored shift back to 0 unwinds the cover along the same swirl.
  function swirlOffset(px, py, cx, cy, spin, brush, out) {
    var dx = px - cx;
    var dy = py - cy;
    var dist = Math.hypot(dx, dy);
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    if (dist >= brush || brush <= 0) return out;
    var u = dist < 0.001 ? 1 : 1 - dist / brush;
    var falloff = smoother(u);
    out[2] = falloff;
    if (dist < 0.001) return out;
    var ang = -spin * MAX_TURN * falloff;
    var cos = Math.cos(ang);
    var sin = Math.sin(ang);
    var gain = 1 + INWARD * falloff;
    var rx = (dx * cos - dy * sin) * gain;
    var ry = (dx * sin + dy * cos) * gain;
    out[0] = rx - dx;
    out[1] = ry - dy;
    return out;
  }

  function sampleRGB(data, w, h, x, y, out) {
    if (x < 0) x = 0;
    else if (x > w - 1) x = w - 1;
    if (y < 0) y = 0;
    else if (y > h - 1) y = h - 1;
    var x0 = x | 0;
    var y0 = y | 0;
    var x1 = x0 + 1 < w ? x0 + 1 : x0;
    var y1 = y0 + 1 < h ? y0 + 1 : y0;
    var tx = x - x0;
    var ty = y - y0;
    var rx = 1 - tx;
    var ry = 1 - ty;
    var w00 = rx * ry;
    var w10 = tx * ry;
    var w01 = rx * ty;
    var w11 = tx * ty;
    var i00 = (y0 * w + x0) * 4;
    var i10 = (y0 * w + x1) * 4;
    var i01 = (y1 * w + x0) * 4;
    var i11 = (y1 * w + x1) * 4;
    out[0] = data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11;
    out[1] = data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11;
    out[2] = data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11;
  }

  function claimHover(state) {
    if (hovering === state) return;
    if (hovering) {
      var previous = hovering;
      previous.hovering = false;
      if (previous.canvas && previous.peak > 0) previous.start();
    }
    hovering = state;
    state.hovering = true;
  }

  function releaseHover(state) {
    var was = hovering === state || state.hovering;
    state.hovering = false;
    if (hovering === state) hovering = null;
    if (!was || !state.canvas) return;
    if (state.peak > 0) state.start();
  }

  function enqueueMount(state) {
    if (state.canvas || state.queued) return;
    state.queued = true;
    pendingMounts.push(state);
    if (!mountScheduled) {
      mountScheduled = true;
      window.requestAnimationFrame(runMounts);
    }
  }

  function takeNextMount() {
    var best = 0;
    for (var i = 0; i < pendingMounts.length; i++) {
      var state = pendingMounts[i];
      if (state.inView()) {
        best = i;
        break;
      }
    }
    var next = pendingMounts[best];
    pendingMounts.splice(best, 1);
    return next;
  }

  function runMounts() {
    mountScheduled = false;
    var start = window.performance && performance.now ? performance.now() : 0;
    while (pendingMounts.length) {
      var state = takeNextMount();
      state.queued = false;
      if (state.img && !state.canvas) state.mount(state.hovering ? 'hover' : 'sharp');
      var now = window.performance && performance.now ? performance.now() : start + 20;
      if (now - start > 12) break;
    }
    if (pendingMounts.length) {
      mountScheduled = true;
      window.requestAnimationFrame(runMounts);
    }
  }

  function State(link, tile) {
    this.link = link;
    this.tile = tile;
    this.src = tile.getAttribute('data-cover');
    this.hovering = false;
    this.queued = false;
    this.tracking = false;
    this.introStarted = false;
    this.introLive = false;
    this.lagging = false;
    this.lagTimer = 0;
    this.shownPx = null;
    this.filterText = '';
    this.clientX = 0;
    this.clientY = 0;
    this.cx = 0;
    this.cy = 0;
    this.prevCx = 0;
    this.prevCy = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.spin = 1;
    this.spinTarget = 1;
    this.travel = 0;
    this.flipAt = 90;
    this.speed = 0;
    this.radiusScale = 1;
    this.stillTime = 0;
    this.prevTargetX = 0;
    this.prevTargetY = 0;
    this.brush = 0;
    this.blurRadiusPx = 0;
    this.peak = 0;
    this.running = false;
    this.raf = 0;
    this.last = 0;
    this.img = null;
    this.loading = false;
    this.canvas = null;
    this.ctx = null;
    this.sharp = null;
    this.output = null;
    this.grid = null;
    this.sampleShift = [0, 0, 0];
    this.rgb = [0, 0, 0];
    this.swirlTmp = [0, 0, 0];
    this.blurCanvas = null;
    this.blurCtx = null;
    this.w = 0;
    this.h = 0;
  }

  State.prototype.pointer = function (event) {
    this.clientX = event.clientX;
    this.clientY = event.clientY;
  };

  State.prototype.visibleFraction = function () {
    var rect = this.tile.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return 0;
    var vw = window.innerWidth || document.documentElement.clientWidth || 0;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    var visibleW = Math.min(rect.right, vw) - Math.max(rect.left, 0);
    var visibleH = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
    if (visibleW <= 0 || visibleH <= 0) return 0;
    var ratio = (visibleW * visibleH) / (rect.width * rect.height);
    if (ratio >= 0.995) return 1;
    if (ratio <= 0.005) return 0;
    return ratio;
  };

  State.prototype.inView = function () {
    return this.visibleFraction() >= 0.2;
  };

  State.prototype.blurPx = function (ratio) {
    if (ratio >= 1) return 0;
    if (ratio <= 0) return MAX_BLUR;
    return (1 - ratio) * MAX_BLUR;
  };

  State.prototype.armLag = function () {
    var self = this;
    window.clearTimeout(this.lagTimer);
    this.lagTimer = window.setTimeout(function () {
      self.lagging = false;
      if (self.canvas) self.canvas.classList.add('is-tracking');
    }, INTRO_MS + 50);
  };

  State.prototype.setFilter = function (px) {
    if (!this.canvas) return;
    if (px < 0.15) px = 0;
    var next = px === 0 ? 'blur(0px)' : 'blur(' + px.toFixed(2) + 'px)';
    if (this.filterText === next) return;

    var prev = this.shownPx;
    if (prev != null && px > prev + 0.35) {
      this.lagging = false;
      window.clearTimeout(this.lagTimer);
      this.canvas.classList.add('is-tracking');
    } else if (prev != null && px < prev - 2.5) {
      if (!this.lagging) {
        this.canvas.classList.remove('is-tracking');
        void this.canvas.offsetWidth;
        this.lagging = true;
      }
      this.armLag();
    } else if (!this.lagging) {
      this.canvas.classList.add('is-tracking');
    } else {
      this.armLag();
    }

    this.shownPx = px;
    this.filterText = next;
    this.canvas.style.filter = next;
  };

  // A cover eases out of blur the first time it appears, and again whenever
  // a fast scroll would otherwise snap it sharp. Slow scrolling still tracks
  // the visible fraction, including while the cover moves back out of view.
  State.prototype.applyBlur = function () {
    if (reduce || !this.canvas) return;
    var px = this.blurPx(this.visibleFraction());
    if (this.tracking) {
      this.setFilter(px);
      return;
    }
    if (!this.introStarted) {
      if (px >= MAX_BLUR - 0.2) {
        this.setFilter(MAX_BLUR);
        return;
      }
      this.startIntro();
      return;
    }
    if (this.introLive) this.setFilter(px);
  };

  State.prototype.startIntro = function () {
    if (this.introStarted) return;
    this.introStarted = true;
    var self = this;
    this.setFilter(MAX_BLUR);
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        if (!self.canvas || self.tracking) return;
        self.introLive = true;
        self.filterText = '';
        self.applyBlur();
      });
    });
    window.setTimeout(function () {
      self.finishIntro();
    }, INTRO_MS + 60);
  };

  State.prototype.finishIntro = function () {
    if (this.tracking || !this.canvas) return;
    this.tracking = true;
    this.introLive = false;
    this.filterText = '';
    this.setFilter(this.blurPx(this.visibleFraction()));
  };

  State.prototype.retarget = function () {
    if (this.peak > 0.8) return;
    this.spinTarget = Math.random() < 0.5 ? -1 : 1;
    this.spin = this.spinTarget;
    this.travel = 0;
    this.flipAt = 70 + Math.random() * 50;
    this.speed = 0;
    this.radiusScale = 1;
    this.stillTime = 0;
  };

  State.prototype.brushRadius = function () {
    var span = Math.min(this.w, this.h) || 1;
    var fraction = BRUSH_FAST + (BRUSH_SLOW - BRUSH_FAST) * this.radiusScale;
    var x = this.stillTime / GROW_TAU;
    var grow = (x * x) / (1 + x * x);
    fraction = fraction / (1 - grow);
    this.brush = span * fraction;
    this.blurRadiusPx = span * BLUR_FRACTION;
    return this.brush;
  };

  State.prototype.contentBox = function () {
    var rect = this.link.getBoundingClientRect();
    var width = this.link.clientWidth;
    var height = this.link.clientHeight;
    var left = rect.left + (rect.width - width) / 2;
    var top = rect.top + (rect.height - height) / 2;
    return { left: left, top: top, width: width, height: height };
  };

  State.prototype.bufferSize = function () {
    var box = this.contentBox();
    return {
      w: Math.max(1, Math.round(box.width)),
      h: Math.max(1, Math.round(box.height)),
      rect: box
    };
  };

  State.prototype.sizeMismatch = function () {
    if (!this.canvas) return false;
    var size = this.bufferSize();
    return Math.abs(size.w - this.w) > 1 || Math.abs(size.h - this.h) > 1;
  };

  State.prototype.placeCursor = function (snap) {
    var rect = this.contentBox();
    if (rect.width <= 0 || rect.height <= 0 || !this.w) return;
    var nx = (this.clientX - rect.left) / rect.width;
    var ny = (this.clientY - rect.top) / rect.height;
    if (nx < 0) nx = 0;
    else if (nx > 1) nx = 1;
    if (ny < 0) ny = 0;
    else if (ny > 1) ny = 1;
    this.targetX = nx * (this.w - 1);
    this.targetY = ny * (this.h - 1);
    if (snap) {
      this.cx = this.targetX;
      this.cy = this.targetY;
      this.prevCx = this.cx;
      this.prevCy = this.cy;
      this.prevTargetX = this.targetX;
      this.prevTargetY = this.targetY;
    }
  };

  State.prototype.load = function () {
    if (this.img || this.loading || !this.src) return;
    var self = this;
    this.loading = true;
    var img = new Image();
    img.onload = function () {
      self.loading = false;
      if (!img.naturalWidth) {
        self.giveUp();
        return;
      }
      self.img = img;
      if (self.hovering) self.mount('hover');
      else enqueueMount(self);
    };
    img.onerror = function () {
      self.loading = false;
      self.giveUp();
    };
    img.src = this.src;
  };

  State.prototype.giveUp = function () {
    if (this.tile) this.tile.removeAttribute('data-pigment');
  };

  State.prototype.mount = function (mode) {
    if (!this.img) return;
    if (this.hovering) mode = 'hover';
    var size = this.bufferSize();
    if (size.rect.width < 2 || size.rect.height < 2) return;

    try {
      var sharpCanvas = document.createElement('canvas');
      sharpCanvas.width = size.w;
      sharpCanvas.height = size.h;
      var sctx = sharpCanvas.getContext('2d', { willReadFrequently: true });
      if (!sctx) throw new Error('context');
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      drawCover(sctx, this.img, size.w, size.h);

      var canvas = document.createElement('canvas');
      canvas.className = 'pigment-canvas';
      canvas.width = size.w;
      canvas.height = size.h;
      canvas.setAttribute('aria-hidden', 'true');
      canvas.draggable = false;
      var ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('context');

      this.dropCanvas();
      this.w = size.w;
      this.h = size.h;
      this.sharp = sctx.getImageData(0, 0, size.w, size.h);
      this.output = ctx.createImageData(size.w, size.h);
      this.grid = new Float32Array(GRID * GRID * 3);
      this.peak = 0;
      var blurCanvas = document.createElement('canvas');
      blurCanvas.width = size.w;
      blurCanvas.height = size.h;
      this.blurCanvas = blurCanvas;
      this.blurCtx = blurCanvas.getContext('2d');
      this.canvas = canvas;
      this.ctx = ctx;

      if (mode === 'hover') {
        this.placeCursor(true);
        this.render();
      } else {
        this.render();
      }

      this.link.insertBefore(canvas, this.link.firstChild);
      this.applyBlur();
      if (mode === 'hover') this.start();
    } catch (err) {
      this.dispose();
    }
  };

  State.prototype.ensure = function () {
    if (this.canvas && !this.sizeMismatch()) {
      this.placeCursor(false);
      var dx = this.targetX - this.cx;
      var dy = this.targetY - this.cy;
      var reach = Math.min(this.w, this.h) * BRUSH_SLOW;
      if (dx * dx + dy * dy > reach * reach) {
        this.cx = this.targetX;
        this.cy = this.targetY;
        this.prevCx = this.cx;
        this.prevCy = this.cy;
        this.prevTargetX = this.targetX;
        this.prevTargetY = this.targetY;
      }
      this.start();
      return;
    }
    if (this.img) this.mount('hover');
  };

  State.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    var self = this;
    var step = function (now) {
      if (!self.running) return;
      self.raf = window.requestAnimationFrame(step);
      self.frame(now);
    };
    this.raf = window.requestAnimationFrame(step);
  };

  State.prototype.stop = function () {
    this.running = false;
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  State.prototype.dropCanvas = function () {
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.canvas = null;
    this.ctx = null;
    this.blurCanvas = null;
    this.blurCtx = null;
    this.sharp = null;
    this.output = null;
    this.grid = null;
  };

  State.prototype.dispose = function () {
    this.hovering = false;
    this.peak = 0;
    this.stop();
    this.dropCanvas();
    if (hovering === this) hovering = null;
    this.giveUp();
  };

  State.prototype.steerSpin = function (dt) {
    var moved = Math.hypot(this.targetX - this.prevTargetX, this.targetY - this.prevTargetY);
    this.prevTargetX = this.targetX;
    this.prevTargetY = this.targetY;
    this.prevCx = this.cx;
    this.prevCy = this.cy;
    if (!this.hovering) return;
    this.travel += moved;
    if (this.travel >= this.flipAt) {
      this.travel = 0;
      this.flipAt = 80 + Math.random() * 140;
      this.spinTarget = Math.random() < 0.5 ? -1 : 1;
    }
    var follow = 1 - Math.exp(-SPIN_FOLLOW * dt);
    this.spin += (this.spinTarget - this.spin) * follow;

    var span = Math.min(this.w, this.h) || 1;
    var instant = moved / span / Math.max(dt, 0.001);
    var speedFollow = 1 - Math.exp(-12 * dt);
    this.speed += (instant - this.speed) * speedFollow;
    var u = this.speed / SPEED_FULL;
    if (u < 0) u = 0;
    else if (u > 1) u = 1;
    var targetScale = 1 - smoother(u);
    var sizeRate = targetScale > this.radiusScale ? SIZE_GROW : SIZE_SHRINK;
    this.radiusScale += (targetScale - this.radiusScale) * (1 - Math.exp(-sizeRate * dt));
    if (this.speed < STILL_SPEED) {
      this.stillTime += dt;
    } else {
      this.stillTime += (0 - this.stillTime) * (1 - Math.exp(-SIZE_SHRINK * dt));
    }
  };

  State.prototype.offsetAt = function (x, y, out) {
    var gx = (x / (this.w - 1)) * (GRID - 1);
    var gy = (y / (this.h - 1)) * (GRID - 1);
    if (gx < 0) gx = 0;
    else if (gx > GRID - 1) gx = GRID - 1;
    if (gy < 0) gy = 0;
    else if (gy > GRID - 1) gy = GRID - 1;
    var x0 = gx | 0;
    var y0 = gy | 0;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    var x1 = x0 + 1 < GRID ? x0 + 1 : x0;
    var y1 = y0 + 1 < GRID ? y0 + 1 : y0;
    var tx = gx - x0;
    var ty = gy - y0;
    var grid = this.grid;
    var i00 = (y0 * GRID + x0) * 3;
    var i10 = (y0 * GRID + x1) * 3;
    var i01 = (y1 * GRID + x0) * 3;
    var i11 = (y1 * GRID + x1) * 3;
    var rx = 1 - tx;
    var ry = 1 - ty;
    var w00 = rx * ry;
    var w10 = tx * ry;
    var w01 = rx * ty;
    var w11 = tx * ty;
    out[0] = grid[i00] * w00 + grid[i10] * w10 + grid[i01] * w01 + grid[i11] * w11;
    out[1] = grid[i00 + 1] * w00 + grid[i10 + 1] * w10 + grid[i01 + 1] * w01 + grid[i11 + 1] * w11;
    out[2] = grid[i00 + 2] * w00 + grid[i10 + 2] * w10 + grid[i01 + 2] * w01 + grid[i11 + 2] * w11;
  };

  State.prototype.settleGrid = function (dt) {
    var grid = this.grid;
    var w = this.w;
    var h = this.h;
    var brush = this.brushRadius();
    var cx = this.cx;
    var cy = this.cy;
    var spin = this.spin;
    var hoveringNow = this.hovering;
    var tmp = this.swirlTmp;
    var maxBlur = this.blurRadiusPx;
    var peak = 0;
    var rise = 1 - Math.exp(-RISE * dt);
    var fall = 1 - Math.exp(-FALL * dt);

    for (var j = 0; j < GRID; j++) {
      var py = (j + 0.5) / GRID * (h - 1);
      for (var i = 0; i < GRID; i++) {
        var index = (j * GRID + i) * 3;
        var tx = 0;
        var ty = 0;
        var tb = 0;
        if (hoveringNow) {
          var px = (i + 0.5) / GRID * (w - 1);
          swirlOffset(px, py, cx, cy, spin, brush, tmp);
          tx = tmp[0];
          ty = tmp[1];
          tb = tmp[2];
        }
        var ox = grid[index];
        var oy = grid[index + 1];
        var blur = grid[index + 2];
        var pulling = hoveringNow && (tb > 0.02 || tx * tx + ty * ty > 0.25);
        var rate = pulling ? rise : fall;
        ox += (tx - ox) * rate;
        oy += (ty - oy) * rate;
        blur += (tb - blur) * rate;
        if (ox * ox + oy * oy < 0.04) {
          ox = 0;
          oy = 0;
        }
        if (blur < 0.004) blur = 0;
        grid[index] = ox;
        grid[index + 1] = oy;
        grid[index + 2] = blur;
        var mag = ox * ox + oy * oy;
        var blurPx = blur * maxBlur;
        if (blurPx * blurPx > mag) mag = blurPx * blurPx;
        if (mag > peak) peak = mag;
      }
    }
    this.peak = Math.sqrt(peak);
  };

  State.prototype.frame = function (now) {
    var dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;

    if (this.sizeMismatch()) {
      this.mount(this.hovering ? 'hover' : 'sharp');
      return;
    }
    if (!this.canvas || !this.grid) return;

    if (this.hovering) this.placeCursor(false);
    var follow = 1 - Math.exp(-FOLLOW * dt);
    this.cx += (this.targetX - this.cx) * follow;
    this.cy += (this.targetY - this.cy) * follow;
    this.steerSpin(dt);

    this.settleGrid(dt);
    this.render();
    if (!this.hovering && this.peak === 0) this.stop();
  };

  State.prototype.render = function () {
    var w = this.w;
    var h = this.h;
    var sd = this.sharp.data;
    var od = this.output.data;
    od.set(sd);
    if (this.peak < 0.45) {
      this.ctx.putImageData(this.output, 0, 0);
      return;
    }

    var minX = w;
    var minY = h;
    var maxX = 0;
    var maxY = 0;
    var grid = this.grid;
    for (var j = 0; j < GRID; j++) {
      for (var i = 0; i < GRID; i++) {
        var gi = (j * GRID + i) * 3;
        if (grid[gi] * grid[gi] + grid[gi + 1] * grid[gi + 1] < 0.36 && grid[gi + 2] < 0.03) continue;
        var x0 = Math.floor(i / GRID * w);
        var y0 = Math.floor(j / GRID * h);
        var x1 = Math.ceil((i + 1) / GRID * w);
        var y1 = Math.ceil((j + 1) / GRID * h);
        if (x0 < minX) minX = x0;
        if (y0 < minY) minY = y0;
        if (x1 > maxX) maxX = x1;
        if (y1 > maxY) maxY = y1;
      }
    }
    if (maxX <= minX || maxY <= minY) {
      this.ctx.putImageData(this.output, 0, 0);
      return;
    }
    if (minX < 0) minX = 0;
    if (minY < 0) minY = 0;
    if (maxX > w) maxX = w;
    if (maxY > h) maxY = h;

    var shift = this.sampleShift;
    var rgb = this.rgb;
    for (var y = minY; y < maxY; y++) {
      var row = y * w;
      for (var x = minX; x < maxX; x++) {
        this.offsetAt(x, y, shift);
        if (shift[0] * shift[0] + shift[1] * shift[1] < 0.2) continue;
        var index = (row + x) * 4;
        sampleRGB(sd, w, h, x + shift[0], y + shift[1], rgb);
        od[index] = rgb[0];
        od[index + 1] = rgb[1];
        od[index + 2] = rgb[2];
        od[index + 3] = 255;
      }
    }

    this.ctx.putImageData(this.output, 0, 0);
    this.mixBlur(minX, minY, maxX, maxY);
  };

  State.prototype.mixBlur = function (minX, minY, maxX, maxY) {
    if (!this.blurCtx || !this.blurCtx.filter) return;
    var radius = this.blurRadiusPx;
    if (radius < 0.5) return;
    var bctx = this.blurCtx;
    bctx.clearRect(0, 0, this.w, this.h);
    bctx.filter = 'blur(' + radius.toFixed(2) + 'px)';
    bctx.drawImage(this.canvas, 0, 0);
    bctx.filter = 'none';
    var soft = bctx.getImageData(0, 0, this.w, this.h).data;
    var od = this.output.data;
    var shift = this.sampleShift;
    var w = this.w;
    for (var y = minY; y < maxY; y++) {
      var row = y * w;
      for (var x = minX; x < maxX; x++) {
        this.offsetAt(x, y, shift);
        var amount = shift[2];
        if (amount < 0.02) continue;
        var index = (row + x) * 4;
        var keep = 1 - amount;
        od[index] = od[index] * keep + soft[index] * amount;
        od[index + 1] = od[index + 1] * keep + soft[index + 1] * amount;
        od[index + 2] = od[index + 2] * keep + soft[index + 2] * amount;
      }
    }
    this.ctx.putImageData(this.output, 0, 0);
  };

  function bind(tile) {
    var link = tile.querySelector('.tile-inner');
    if (!link || !tile.getAttribute('data-cover')) return;

    tile.setAttribute('data-pigment', 'on');
    var state = new State(link, tile);
    allStates.push(state);
    tile._coverPigment = state;
    state.load();

    if (typeof window.PointerEvent !== 'function') return;

    var inside = false;

    function tryStart(event) {
      if (reduce) return;
      if (event) state.pointer(event);
      if (!inside) return;
      state.retarget();
      claimHover(state);
      state.ensure();
    }

    tile.addEventListener('pointerenter', function (event) {
      if (event.pointerType === 'touch') return;
      inside = true;
      tryStart(event);
    });

    tile.addEventListener('pointermove', function (event) {
      if (event.pointerType === 'touch') return;
      state.pointer(event);
      if (inside && hovering !== state) tryStart(event);
    });

    tile.addEventListener('pointerleave', function (event) {
      if (event.pointerType === 'touch') return;
      inside = false;
      releaseHover(state);
    });

    tile.addEventListener('pointercancel', function () {
      inside = false;
      releaseHover(state);
    });
  }

  for (var n = 0; n < tiles.length; n++) bind(tiles[n]);

  window.setTimeout(function () {
    for (var i = 0; i < allStates.length; i++) {
      var state = allStates[i];
      if (state.img && !state.canvas && !state.queued) enqueueMount(state);
    }
  }, 400);

  var blurScheduled = false;
  function scheduleBlur() {
    if (reduce || blurScheduled) return;
    blurScheduled = true;
    window.requestAnimationFrame(function () {
      blurScheduled = false;
      for (var i = 0; i < allStates.length; i++) allStates[i].applyBlur();
    });
  }

  window.addEventListener('scroll', scheduleBlur, { passive: true });
  window.addEventListener('resize', scheduleBlur);

  window.addEventListener('resize', function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      for (var i = 0; i < allStates.length; i++) {
        var state = allStates[i];
        if (state.img && !state.canvas && !state.queued) {
          enqueueMount(state);
          continue;
        }
        if (!state.canvas || state.running || !state.sizeMismatch()) continue;
        state.mount('sharp');
      }
    }, 180);
  });
})();

// AuroraDrop's "initial effects": processing applied each frame to what is
// already on the shared canvas, before the audio patterns draw. Ported from
// the PatternEffect_* files of AuroraDrop, which carry the Aurora MIT notice
// (Copyright (c) 2014 Jason Coon); see ./NOTICE.md.
import { SIZE, CENTER } from './runtime.js';

// A: fade, then a blur whose strength breathes.
export class Blur2d {
  static title = '2D Blurring';

  draw(canvas) {
    canvas.DimAll(230);
    canvas.blur2d(canvas.beatsin8(2, 10, 255));
  }
}

// B: the picture is dragged round a spiral whose centre scrolls sideways.
export class SpiralStream1 {
  static title = 'Spiral Streaming';

  start(canvas) {
    // Ranges are AuroraDrop's own; several of them allow only one value.
    this.addBlur = canvas.random8(0, 1) !== 0;
    this.dimAll = canvas.random8(0, 10) !== 0;
    this.scrollStream = canvas.random8(1, 2) !== 0;
    this.dimAmount = canvas.random8(250, 251);
    this.scaleColorDown = canvas.random8(128, 129);
    const choice = canvas.random8(1, 6);
    this.streamRadius = Math.trunc(SIZE / (choice <= 3 ? 2 : choice === 4 ? 3 : 4));
    this.centerX = CENTER - 1;
    this.centerY = CENTER - 1;
  }

  draw(canvas) {
    if (this.dimAll) canvas.DimAll(this.dimAmount);
    if (this.streamRadius !== SIZE / 2) canvas.DimAll(this.dimAmount);
    canvas.SpiralStream(this.centerX, this.centerY, this.streamRadius, this.scaleColorDown);
    if (this.addBlur) canvas.blur2d(255);
    if (this.scrollStream) {
      this.centerX++;
      if (this.centerX > SIZE - 1) this.centerX = 0;
    }
  }
}

// C: the picture streams towards the top-left corner. AuroraDrop's source
// lists six directions but its random range only ever selects this one.
export class Stream1 {
  static title = 'Directional Stream';

  start(canvas) {
    this.scaleColorDown = canvas.random8(128, 129);
  }

  draw(canvas) {
    canvas.StreamUpAndLeft(this.scaleColorDown);
  }
}

// D: fade and shift the whole picture, wrapping diagonally or falling.
export class Move {
  static title = 'Directional Move';

  start(canvas) {
    this.direction = canvas.random8(0, 2);
  }

  draw(canvas) {
    canvas.DimAll(200);
    if (this.direction === 0) {
      canvas.MoveY(1);
      canvas.MoveX(1);
    } else {
      canvas.MoveDown();
    }
  }
}

// The effects AuroraDrop has enabled.
export const EFFECTS = [Blur2d, SpiralStream1, Stream1, Move];

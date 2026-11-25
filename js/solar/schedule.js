// Build complete equipment groups off-scene. Check the clock at natural
// boundaries, including inside grid searches, without a timer per operation.
export async function runInSlices(ctx,steps) {
  let start=performance.now();
  for (;;) {
    const step=steps.next();
    if (step.done) return step.value;
    if (performance.now()-start>=10) {
      await ctx.breathe();
      start=performance.now();
    }
  }
}

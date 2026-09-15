/*
 * Runs before the composer, as a classic script, so that a failure to load it - a module missing
 * from the staged assets, say - reaches the app as a message instead of a thirty-second silence.
 * Capturing on window is what sees a script element's load error; it does not bubble.
 */
window.addEventListener('error', function (event) {
  var target = event.target;
  var message = target && target.src ? 'could not load ' + target.src : (event.message || 'script error') + (event.filename ? ' (' + event.filename + ':' + event.lineno + ')' : '');
  FTreeBook.fail(message);
}, true);
window.addEventListener('unhandledrejection', function (event) {
  FTreeBook.fail(String((event.reason && event.reason.stack) || event.reason));
});

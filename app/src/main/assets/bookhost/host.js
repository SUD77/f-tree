/*
 * The composer's end of the bridge. The app sets the input, calls ftreeCompose(), and waits for
 * deliver or fail - synchronously composed, because a WebView with no window fires no animation
 * frames and throttles its timers (see site/book/compose.js).
 */
import { composeBook } from '../book/site/book/compose.js';

window.ftreeCompose = () => {
  try {
    const input = JSON.parse(FTreeBook.input());
    const book = composeBook(input.doc, input.options, input.template, input.allowance || {});
    FTreeBook.deliver(JSON.stringify(book));
  } catch (error) {
    FTreeBook.fail(String((error && error.stack) || error));
  }
};

FTreeBook.ready();

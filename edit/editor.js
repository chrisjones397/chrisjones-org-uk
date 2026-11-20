/* The editor page (edit/index.html) starts here. Its views:
     #gallery  add a painting (at the top, from a photo in the Library), and change the genres and paintings
     #content  change the page's words, section by section.
     #library  everything uploaded (the only place files come in): what is made from each and what uses it
     #review   every unpublished change, each with a tick: publish the ticked ones, or all, or discard them.
     #history  each publication, and every earlier version of anything, which can be brought back as a draft.
     #darkroom/<item>/<recipe>  preparing a photo for the site (opened from the Library and the Gallery, not the
               header): white balance, squaring up a flat thing or straightening and cropping a scene.
   One saving rule: every change saves itself as a draft at once, everywhere (paintings too: there is no Save
   button), and a tick on the right of what was changed says so (marks.js). Nothing reaches visitors until it's
   published under Review; the preview (the site at this address) shows drafts in place.
   Three distinct ways to take something away: Hide (off the site, kept here: an eye), Remove (out of the page;
   its photo stays in the Library), and Delete for good (in the Library, only when nothing uses it).
   It talks to editor.js on the server through /edit/api/.

   The modules (each imports only from those above it in this list, so nothing goes round in a circle):
     dom.js           making page elements, the symbols, the message at the bottom
     state.js         what the editor knows (the entries, the Library, History) and how to read it
     marks.js         the saved tick
     render.js        drawing the current view afresh
     server.js        talking to the server; the save queue; discard
     widgets.js       the badge and the eye
     drag.js          dragging to rearrange (paintings and genres): pointer, touch and keyboard
     darkroom.js      the pixels: white balance, squaring up, the full-screen views (it stands alone)
     uploads.js       files into storage and the Library: originals, renditions (sizes; video versions and frames)
     details.js       a painting's medium, size and year fields
     picker.js        the Library's items, and the pictures prepared from them, as tiles to pick from
     picture.js       the darkroom as a form
     painting.js      a painting's row, Edit form and picture
     add.js           adding (hanging) a painting, from a picture prepared in the darkroom
     background.js    a section's background box
     uses.js          what uses a Library item, as marks
     compare.js       side by side, and blink
     gallery-view.js, content-view.js, library-view.js, review-view.js, history-view.js, darkroom-view.js   the six views
     editor.js        this file: registers the views and starts */

import { $, h } from './dom.js';
import { state } from './state.js';
import { views, render } from './render.js';
import { call } from './server.js';
import { galleryView } from './gallery-view.js';
import { contentView } from './content-view.js';
import { libraryView } from './library-view.js';
import { reviewView } from './review-view.js';
import { historyView } from './history-view.js';
import { darkroomView } from './darkroom-view.js';

Object.assign(views, { gallery: galleryView, content: contentView, library: libraryView, review: reviewView, history: historyView, darkroom: darkroomView });

call('GET', 'state').then((d) => { state.media = d.media; state.who = d.who; render(); })
  .catch((e) => { $('#main').replaceChildren(h('p', {}, `Couldn't load the content: ${e.message}`)); });

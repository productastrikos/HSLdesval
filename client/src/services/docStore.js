// ─────────────────────────────────────────────────────────────────────────────
// Browser document store (IndexedDB)
//
//   • "base"  — the pre-parsed knowledge-base documents, cached once and kept
//               across every session on this machine. Internal to the AI/RAG
//               engine; never surfaced in the UI.
//   • "user"  — documents the user uploads. Visible across the app (via the
//               document picker) and cleared the moment the user logs out.
//
// A small event ('docstore:changed') lets open pages refresh their pickers when
// a document is added or removed.
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'hsl_docstore';
const DB_VERSION = 2;
const BASE_STORE = 'base';
const USER_STORE = 'user';
const LIBRARY_STORE = 'library';   // pre-loaded HSL documents (persist across sessions)

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BASE_STORE))    db.createObjectStore(BASE_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(USER_STORE))    db.createObjectStore(USER_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(LIBRARY_STORE)) db.createObjectStore(LIBRARY_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    Promise.resolve(fn(os)).then(r => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function emitChange() {
  try { window.dispatchEvent(new Event('docstore:changed')); } catch (_) {}
}

// ── Base knowledge-base cache ────────────────────────────────────────────────
export async function hasBaseDocs() {
  try {
    const count = await tx(BASE_STORE, 'readonly', os => reqToPromise(os.count()));
    return count > 0;
  } catch (_) { return false; }
}

export async function cacheBaseDocs(docs = []) {
  if (!docs.length) return;
  await tx(BASE_STORE, 'readwrite', os => {
    for (const d of docs) os.put({ id: d.id, name: d.name, text: d.text || '' });
  });
}

export async function getBaseDocs() {
  try { return await tx(BASE_STORE, 'readonly', os => reqToPromise(os.getAll())); }
  catch (_) { return []; }
}

// ── User-uploaded documents ──────────────────────────────────────────────────
// A record: { id, name, type, mime, pages, textLength, addedAt, text, file }
export async function addUserDoc(doc) {
  const record = {
    id:         doc.id,
    name:       doc.name,
    type:       doc.type || 'General Document',
    mime:       doc.mime || '',
    pages:      doc.pages || 0,
    textLength: doc.textLength || (doc.text ? doc.text.length : 0),
    addedAt:    doc.addedAt || new Date().toISOString(),
    text:       doc.text || '',
    file:       doc.file || null,   // original Blob/File — used by vision features
  };
  try {
    await tx(USER_STORE, 'readwrite', os => os.put(record));
  } catch (e) {
    const name = (e && e.name) || '';
    if (name === 'QuotaExceededError' || /quota|storage/i.test(e && e.message ? e.message : '')) {
      throw new Error('Not enough browser storage to save this document. Remove some documents and try again.');
    }
    throw new Error('Could not save the document in your browser. Please try again.');
  }
  emitChange();
  return record;
}

// Lightweight list (no text / blob payloads) for pickers and tables.
export async function listUserDocs() {
  try {
    const all = await tx(USER_STORE, 'readonly', os => reqToPromise(os.getAll()));
    return all
      .map(({ id, name, type, mime, pages, textLength, addedAt }) => ({ id, name, type, mime, pages, textLength, addedAt }))
      .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
  } catch (_) { return []; }
}

export async function getUserDoc(id) {
  if (!id) return null;
  try { return await tx(USER_STORE, 'readonly', os => reqToPromise(os.get(id))); }
  catch (_) { return null; }
}

export async function removeUserDoc(id) {
  await tx(USER_STORE, 'readwrite', os => os.delete(id));
  emitChange();
}

export async function clearUserDocs() {
  try {
    await tx(USER_STORE, 'readwrite', os => os.clear());
    emitChange();
  } catch (_) {}
}

// ── Pre-loaded document library (persists across sessions) ───────────────────
// Records: { id, name, type, mime, text, isDrawing, libraryFile, source:'library' }
export async function hasLibraryDocs() {
  try { return (await tx(LIBRARY_STORE, 'readonly', os => reqToPromise(os.count()))) > 0; }
  catch (_) { return false; }
}

export async function cacheLibraryDocs(docs = []) {
  if (!docs.length) return;
  await tx(LIBRARY_STORE, 'readwrite', os => {
    for (const d of docs) os.put({
      id: d.id, name: d.name, type: d.type || 'General Document', mime: d.mime || 'application/pdf',
      text: d.text || '', isDrawing: !!d.isDrawing, libraryFile: d.libraryFile || d.id,
      textLength: d.textLength || (d.text ? d.text.length : 0), note: d.note || '', source: 'library',
    });
  });
  emitChange();
}

export async function listLibraryDocs() {
  try {
    const all = await tx(LIBRARY_STORE, 'readonly', os => reqToPromise(os.getAll()));
    return all.map(({ id, name, type, mime, isDrawing, libraryFile, textLength }) =>
      ({ id, name, type, mime, isDrawing, libraryFile, textLength, source: 'library' }));
  } catch (_) { return []; }
}

export async function getLibraryDoc(id) {
  if (!id) return null;
  try { return await tx(LIBRARY_STORE, 'readonly', os => reqToPromise(os.get(id))); }
  catch (_) { return null; }
}

// ── Merged view used by every document picker (user uploads + pre-loaded library)
export async function listSelectableDocs() {
  const [user, lib] = await Promise.all([listUserDocs(), listLibraryDocs()]);
  const userTagged = user.map(d => ({ ...d, source: 'user' }));
  return [...userTagged, ...lib];
}

export async function getSelectableDoc(id) {
  return (await getUserDoc(id)) || (await getLibraryDoc(id));
}

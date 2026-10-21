// Bundle entry: everything the browser side needs from npm, in one ES module.
// Built into shared/core.js by `npm run build:core`. Used by Command Deck's
// interface and by the Field Unit web app.
export { parseCommand } from '../src/commands.js';
export { initializeApp, deleteApp } from 'firebase/app';
export {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence,
  signInAnonymously, onAuthStateChanged
} from 'firebase/auth';
export {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, onSnapshot, writeBatch, Timestamp,
  query, where, waitForPendingWrites
} from 'firebase/firestore';
export { default as QRCode } from 'qrcode';

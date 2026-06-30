// services/authService.js

import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { app } from "../firebase.js";

// Firebase instances
const auth = getAuth(app);
const db = getFirestore(app);

// =========================
// 🔑 EMAIL LOGIN
// =========================
export function loginEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

// =========================
// 🆕 REGISTER (Auth + Firestore)
// =========================
export async function registerEmail(email, password, name = "") {
  const userCredential = await createUserWithEmailAndPassword(
    auth,
    email,
    password
  );

  const user = userCredential.user;

  // salva perfil no Firestore
try {
  await setDoc(
    doc(db, "users", user.uid),
    {
      name: user.displayName || "",
      email: user.email,
      photoURL: user.photoURL || "",
      provider: "google",
      lastLogin: new Date()
    },
    { merge: true }
  );
} catch (e) {
  console.error("SETDOC FALHOU:", e);
}

return user;

  return user;
}

// =========================
// 🌐 GOOGLE LOGIN
// =========================
export async function loginGoogle() {
  const provider = new GoogleAuthProvider();

  const result = await signInWithPopup(auth, provider);
  const user = result.user;

  // cria/atualiza perfil no Firestore
  await setDoc(
    doc(db, "users", user.uid),
    {
      name: user.displayName || "",
      email: user.email,
      photoURL: user.photoURL || "",
      provider: "google",
      lastLogin: new Date()
    },
    { merge: true }
  );

  return user;
}

// =========================
// 👤 PEGAR PERFIL USUÁRIO
// =========================
export async function getUserProfile(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    return snap.data();
  }

  return null;
}

// =========================
// 👀 OBSERVAR AUTH STATE
// =========================
export function observeAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

// =========================
// 🚪 LOGOUT
// =========================
export function logout() {
  return signOut(auth);
}

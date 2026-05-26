// firebase.js

import { initializeApp }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import { getAuth }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import { getFirestore }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDQpugwMlDQsEJPde__pcoLthdlcCDN3Yw",
  authDomain: "produkti-web.firebaseapp.com",
  projectId: "produkti-web",
  storageBucket: "produkti-web.firebasestorage.app",
  messagingSenderId: "462813148281",
  appId: "1:462813148281:web:d5004b2032d0fa6fcfd0a8"
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

export const db = getFirestore(app);
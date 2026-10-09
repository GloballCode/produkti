// services/receiptService.js
// Comprovantes de pagamento (PIX) guardados no próprio Firestore, numa subcoleção:
//   users/{uid}/businesses/{bizId}/receipts/{receiptId}
// Por que Firestore e não Cloudinary: o Cloudinary (upload sem assinatura) gera URL pública
// e não deixa apagar pelo navegador. Aqui o comprovante fica privado (só o dono lê, pelas
// rules), é apagado junto com a venda e não depende de nenhum serviço novo.
//
// A imagem é comprimida no celular para caber no limite de 1MB por documento do Firestore.
// Na venda guardamos só o "path" do documento (comprovantePath); o conteúdo só é lido
// quando alguém abre o comprovante.

import { db } from "../firebase.js";
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  deleteDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const MAX_FINAL_BYTES = 650 * 1024;          // ~870KB em base64, abaixo do limite de 1MB
const MAX_IMAGE_INPUT_BYTES = 15 * 1024 * 1024; // foto original antes de comprimir

// Retorna uma mensagem de erro (string) ou null se o arquivo é válido.
export function validateReceiptFile(file) {
  if (!file) return "Selecione o comprovante";
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  if (!isImage && !isPdf) return "O comprovante deve ser uma imagem ou PDF";
  if (isPdf && file.size > MAX_FINAL_BYTES) {
    return "PDF muito grande (máx. 650KB). Envie um print do comprovante";
  }
  if (isImage && file.size > MAX_IMAGE_INPUT_BYTES) return "Imagem muito grande (máx. 15MB)";
  return null;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo"));
    reader.readAsDataURL(blob);
  });
}

// Reduz a foto até caber no limite, sem perder a leitura do comprovante.
async function compressImage(file) {
  const bitmap = await createImageBitmap(file); // lança erro p/ formatos não suportados (ex.: HEIC)
  try {
    const steps = [[1400, 0.75], [1200, 0.65], [1000, 0.55], [800, 0.5]];
    for (const [maxSide, quality] of steps) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_FINAL_BYTES) return blob;
    }
  } finally {
    if (bitmap.close) bitmap.close();
  }
  throw new Error("Não consegui reduzir a imagem. Tente um print do comprovante");
}

// Salva o comprovante e devolve { path, tipo }.
export async function uploadReceipt(file, { uid, bizId, saleId }) {
  const error = validateReceiptFile(file);
  if (error) throw new Error(error);

  let blob = file;
  if (file.type.startsWith("image/")) {
    try {
      blob = await compressImage(file);
    } catch (e) {
      // Se o navegador não decodifica o formato, só serve o original se já for pequeno
      if (file.size > MAX_FINAL_BYTES) throw e;
    }
  }

  const dataUrl = await blobToDataUrl(blob);
  const ref = await addDoc(collection(db, "users", uid, "businesses", bizId, "receipts"), {
    saleId: saleId || null,
    tipo: blob.type,
    dataUrl,
    tamanho: blob.size,
    criadoEm: serverTimestamp()
  });

  return { path: ref.path, tipo: blob.type };
}

// Devolve uma URL local (blob:) pronta para <img src> ou "abrir em nova aba".
export async function getReceiptUrl(path) {
  const snap = await getDoc(doc(db, path));
  if (!snap.exists()) throw new Error("Comprovante não encontrado");
  const blob = await (await fetch(snap.data().dataUrl)).blob();
  return URL.createObjectURL(blob);
}

// Apaga um comprovante (best-effort: nunca lança erro).
export async function deleteReceipt(path) {
  if (!path) return;
  try {
    await deleteDoc(doc(db, path));
  } catch (e) {
    console.warn("Não foi possível apagar o comprovante:", path, e);
  }
}

// Apaga todos os comprovantes de um negócio (usado ao excluir o negócio).
export async function deleteAllReceipts(uid, bizId) {
  try {
    const snap = await getDocs(collection(db, "users", uid, "businesses", bizId, "receipts"));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    console.warn("Não foi possível limpar os comprovantes do negócio:", e);
  }
}
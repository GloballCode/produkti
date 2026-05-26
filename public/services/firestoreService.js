import { app, db } from "../firebase.js";
import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Cloudinary Configuration
const CLOUDINARY_CLOUD_NAME = 'dkoxcuhlb'; 
const CLOUDINARY_UPLOAD_PRESET = 'product_imgs';

// ===== BUSINESS =====
export async function addBusiness(name, userId) {
  try {
    const docRef = await addDoc(collection(db, "users", userId, "businesses"), {
      name,
      createdAt: serverTimestamp()
    });
    return { id: docRef.id, name };
  } catch (e) {
    console.error("Erro ao criar negócio:", e);
    throw e;
  }
}

export async function getBusinesses(userId) {
  try {
    const querySnapshot = await getDocs(
      collection(db, "users", userId, "businesses")
    );
    const businesses = [];
    querySnapshot.forEach((doc) => {
      businesses.push({ id: doc.id, ...doc.data() });
    });
    return businesses;
  } catch (e) {
    console.error("Erro ao carregar negócios:", e);
    return [];
  }
}

// ===== PRODUCTS =====
export async function addProduct(businessId, userId, productData, imageFile = null) {
  try {
    const product = {
      ...productData,
      createdAt: serverTimestamp()
    };

    // Primeiro cria o produto
    const docRef = await addDoc(
      collection(db, "users", userId, "businesses", businessId, "products"),
      product
    );

    // Se há imagem, faz upload para Cloudinary
    if (imageFile) {
      const imageUrl = await uploadProductImage(imageFile);
      await updateDoc(docRef, { imageUrl });
      product.imageUrl = imageUrl;
    }

    return { id: docRef.id, ...product };
  } catch (e) {
    console.error("Erro ao adicionar produto:", e);
    throw e;
  }
}

export async function getProducts(businessId, userId) {
  try {
    const querySnapshot = await getDocs(
      collection(db, "users", userId, "businesses", businessId, "products")
    );
    const products = [];
    querySnapshot.forEach((doc) => {
      products.push({ id: doc.id, ...doc.data() });
    });
    return products;
  } catch (e) {
    console.error("Erro ao carregar produtos:", e);
    return [];
  }
}

export async function updateProduct(businessId, userId, productId, updates) {
  try {
    const docRef = doc(
      db,
      "users",
      userId,
      "businesses",
      businessId,
      "products",
      productId
    );
    await updateDoc(docRef, updates);
  } catch (e) {
    console.error("Erro ao atualizar produto:", e);
    throw e;
  }
}

export async function deleteProduct(businessId, userId, productId) {
  try {
    const docRef = doc(
      db,
      "users",
      userId,
      "businesses",
      businessId,
      "products",
      productId
    );
    await deleteDoc(docRef);
  } catch (e) {
    console.error("Erro ao deletar produto:", e);
    throw e;
  }
}

// ===== SALES =====
export async function addSale(businessId, userId, saleData) {
  try {
    const docRef = await addDoc(
      collection(db, "users", userId, "businesses", businessId, "sales"),
      {
        ...saleData,
        createdAt: serverTimestamp()
      }
    );
    return { id: docRef.id, ...saleData };
  } catch (e) {
    console.error("Erro ao adicionar venda:", e);
    throw e;
  }
}

export async function getSales(businessId, userId) {
  try {
    const querySnapshot = await getDocs(
      collection(db, "users", userId, "businesses", businessId, "sales")
    );
    const sales = [];
    querySnapshot.forEach((doc) => {
      sales.push({ id: doc.id, ...doc.data() });
    });
    return sales.sort((a, b) => b.createdAt - a.createdAt);
  } catch (e) {
    console.error("Erro ao carregar vendas:", e);
    return [];
  }
}

// ===== IMAGE UPLOAD WITH CLOUDINARY =====
export async function uploadProductImage(file) {
  try {
    // Validar arquivo
    if (!file) throw new Error('Nenhum arquivo selecionado');

    // Validar tipo
    if (!file.type.startsWith('image/')) {
      throw new Error('Apenas arquivos de imagem são permitidos');
    }

    // Validar tamanho (5MB)
    if (file.size > 5 * 1024 * 1024) {
      throw new Error('Imagem muito grande (máximo 5MB)');
    }

    // Criar FormData para upload
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    formData.append('folder', 'produkti/products');

    // Fazer upload para Cloudinary
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      {
        method: 'POST',
        body: formData
      }
    );

    if (!response.ok) {
      throw new Error('Erro no upload para Cloudinary');
    }

    const data = await response.json();
    return data.secure_url;

  } catch (e) {
    console.error("Erro ao fazer upload da imagem:", e);
    throw e;
  }
}

export async function deleteProductImage(imageUrl) {
  try {
    if (!imageUrl || !imageUrl.includes('cloudinary')) return;

    // Extrair public_id da URL do Cloudinary
    const urlParts = imageUrl.split('/');
    const filename = urlParts[urlParts.length - 1];
    const publicId = `produkti/products/${filename.split('.')[0]}`;

    // Para deletar no Cloudinary, você precisa da API key e secret
    // Por enquanto, apenas removemos a referência do Firestore
    // Para deletar fisicamente, seria necessário uma função server-side
    console.log('Para deletar imagem fisicamente, implemente no backend:', publicId);

  } catch (e) {
    console.error("Erro ao deletar imagem:", e);
    // Não lança erro se a imagem não existir
  }
}

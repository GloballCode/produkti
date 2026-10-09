// app.js

import {
  doc,
  collection,
  getDocs,
  deleteDoc,
  updateDoc,
  getDoc,
  setDoc,
  writeBatch,
  runTransaction,
  increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  getAuth,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import { db } from "./firebase.js";

import {
  loginGoogle,
  observeAuth
} from "./services/authService.js";

import {
  getBusinesses,
  addBusiness,
  getProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  addSale,
  getSales,
  deleteSale,
  uploadProductImage,
  deleteProductImage
} from "./services/firestoreService.js";
import { filterSalesByPeriod, parseSaleDate, summarizeSalesByMonth } from "./services/salesLogic.js";
import {
  uploadReceipt,
  deleteReceipt,
  deleteAllReceipts,
  getReceiptUrl,
  validateReceiptFile
} from "./services/receiptService.js";

// ===== ACESSO / TRIAL / PAGAMENTO =====
// Troque pelo seu número de WhatsApp: DDI + DDD + número, só dígitos.
const url = `https://wa.me/${WHATSAPP_NUMBER}`;
const TRIAL_DAYS = 7;

// ===== STATE =====
const initialState = () => ({
  user: null,
  businesses: [],
  currentBiz: null,
  products: [],
  sales: [],
  cart: [],
  histFilter: 'todas',
  saleTypeFilter: 'todas',
  notificationsEnabled: false,
  access: null,
  busy: false
});
let state = initialState();

// ===== HELPERS =====
// Escapa texto vindo do usuário antes de entrar em innerHTML / atributos.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
));

// Arredonda em centavos (evita 0.1 + 0.2 = 0.30000000000000004).
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const brl = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const METHOD_LABEL = { especie: 'Espécie', cartao: 'Cartão', pix: 'PIX' };

// Referências diretas no Firestore (caminho: users/{uid}/businesses/{biz}/...).
const bizCol = (name) => collection(db, 'users', state.user.uid, 'businesses', state.currentBiz.id, name);
const productRef = (id) => doc(db, 'users', state.user.uid, 'businesses', state.currentBiz.id, 'products', id);
const saleRefOf = (id) => doc(db, 'users', state.user.uid, 'businesses', state.currentBiz.id, 'sales', id);

function todayISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "2026-10-08" → ISO ao meio-dia local (evita virar o dia por fuso horário).
const dateInputToISO = (str) => new Date(`${str}T12:00:00`).toISOString();

function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

// Impede toque duplo: enquanto uma ação está rodando, ignora novas chamadas.
async function guarded(btn, fn) {
  if (state.busy) return;
  state.busy = true;
  const wasDisabled = btn ? btn.disabled : false;
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } finally {
    state.busy = false;
    if (btn) btn.disabled = wasDisabled;
  }
}

// ===== SCREEN ROUTING =====
window.showScreen = function (id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');

  if (id === 'screen-business') renderBusinessList();

  if (id === 'screen-app') {
    navTo('produtos');
    updateStats();
  }
};

// ===== AUTH =====
observeAuth(async (user) => {
  if (!user) {
    state = initialState(); // não deixa dados do usuário anterior na memória
    showScreen('screen-login');
    return;
  }

  try {
    state.user = user;

    const userData = await ensureUserAccess(user.uid);
    state.access = getAccessStatus(userData);

    if (!state.access.allowed) {
      showPaywall();
      return;
    }

    await loadBusinesses();
    showScreen('screen-business');
  } catch (e) {
    console.error(e);
    showToast('❌ Não foi possível carregar sua conta. Entre novamente.');
    try { await signOut(getAuth()); } catch (_) { /* observeAuth(null) cuida do resto */ }
  }
});

// ===== ACESSO: cria/lê o documento do usuário e calcula status =====
async function ensureUserAccess(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, { createdAt: serverTimestamp(), plan: "trial" });
  } else if (!snap.data().createdAt) {
    // Conta antiga sem createdAt: grava só a data. Nunca mexe no plano
    // (antes isso rebaixava quem já era "paid" para "trial").
    await updateDoc(ref, { createdAt: serverTimestamp() });
  } else {
    return snap.data();
  }

  // refaz a leitura pois serverTimestamp() só resolve depois do round-trip
  const freshSnap = await getDoc(ref);
  return freshSnap.data();
}

function getAccessStatus(userData) {
  if (!userData) {
    return { allowed: false, plan: "trial", daysLeft: 0 };
  }

  if (userData.plan === "paid") {
    return { allowed: true, plan: "paid", daysLeft: null };
  }

  const createdAt = userData.createdAt?.toDate
    ? userData.createdAt.toDate()
    : new Date(userData.createdAt);

  const daysElapsed = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  const daysLeft = Math.max(0, Math.ceil(TRIAL_DAYS - daysElapsed));

  return {
    allowed: daysElapsed < TRIAL_DAYS,
    plan: "trial",
    daysLeft
  };
}

// ===== TELA DE PAGAMENTO (injetada via JS, sem precisar editar o HTML) =====
function showPaywall() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

  let screen = document.getElementById('screen-paywall');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'screen-paywall';
    screen.className = 'screen';
    document.body.appendChild(screen);
  }

  const expired = state.access.plan === 'trial' && state.access.daysLeft <= 0;

  const title = expired
    ? 'Seu teste grátis acabou'
    : 'Continue aproveitando o Produkti';

  const msg = expired
    ? `Os ${TRIAL_DAYS} dias gratuitos chegaram ao fim. Para continuar usando o Produkti, faça o pagamento único e libere seu acesso.`
    : `Você ainda tem ${state.access.daysLeft} dia(s) de teste grátis. Quando quiser, já pode liberar o acesso definitivo.`;

  const whatsappMsg = encodeURIComponent(
    `Olá! Quero liberar o acesso ao Produkti.\nMeu e-mail: ${state.user.email}`
  );

  screen.innerHTML = `
    <div style="min-height:100vh; background:#faf2db; display:flex; align-items:center; justify-content:center; padding:24px;">
      <div style="background:var(--white); border-radius:var(--radius); box-shadow:var(--shadow-md); padding:40px 32px; max-width:380px; width:100%; text-align:center; animation:fadeUp .4s ease;">
        <div style="width:64px;height:64px;background:#fdf3d8;border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:30px;">🔒</div>
        <h1 style="font-size:20px;font-weight:800;margin-bottom:8px;">${title}</h1>
        <p style="color:var(--gray);font-size:14px;line-height:1.55;margin-bottom:26px;">${msg}</p>
        <a href="${url}?text=${whatsappMsg}" target="_blank" rel="noopener"
          style="display:flex;align-items:center;justify-content:center;gap:8px;background:var(--gold);color:var(--brown);padding:14px;border-radius:14px;font-weight:700;text-decoration:none;margin-bottom:12px;">
          <i class="bi bi-whatsapp"></i> Falar no WhatsApp
        </a>
        <button onclick="logoutUser()" style="background:none;border:none;color:var(--gray);font-size:13px;text-decoration:underline;cursor:pointer;font-family:inherit;">Sair da conta</button>
      </div>
    </div>
  `;

  screen.classList.add('active');
}

window.logoutUser = async function () {
  try {
    await signOut(getAuth()); // observeAuth(null) limpa o estado e volta ao login
  } catch (e) {
    console.error(e);
    showToast('❌ Não foi possível sair da conta');
  }
};

// ===== LOGIN (apenas Google) =====

// ===== FIREBASE LOAD =====
async function loadBusinesses() {
  const data = await getBusinesses(state.user.uid);
  state.businesses = data;
  renderBusinessList();
}

// ===== BUSINESS =====
window.renderBusinessList = function () {
  const list = document.getElementById('business-list');

  list.innerHTML = state.businesses.map(b => `
    <div class="business-item">
      <div class="business-info" onclick="enterBusiness('${esc(b.id)}')">
        <strong>${esc(b.name)}</strong>
        <span>Toque para entrar</span>
      </div>

      <button
        class="delete-business-btn"
        aria-label="Excluir negócio ${esc(b.name)}"
        onclick="deleteBusiness('${esc(b.id)}')"
      >
        🗑️
      </button>
    </div>
  `).join('');
};

window.enterBusiness = async function (id) {
  const biz = state.businesses.find(b => b.id == id);
  if (!biz) return;

  // Trocou de negócio: carrinho e listas do anterior não podem vazar para este.
  if (!state.currentBiz || state.currentBiz.id !== biz.id) {
    state.cart = [];
    state.products = [];
    state.sales = [];
  }

  state.currentBiz = biz;
  document.getElementById('topbar-biz-name').textContent = biz.name;
  showScreen('screen-app');

  try {
    await loadProductsAndSales();
  } catch (e) {
    console.error(e);
    showToast('❌ Erro ao carregar os dados do negócio');
  }
};

async function loadProductsAndSales() {
  state.products = await getProducts(state.currentBiz.id, state.user.uid);
  state.sales = (await getSales(state.currentBiz.id, state.user.uid)).sort((a, b) => {
    const aTime = parseSaleDate(a)?.getTime() || 0;
    const bTime = parseSaleDate(b)?.getTime() || 0;
    return bTime - aTime;
  });
  renderProducts();
  updateStats();
  renderSellPage();
  checkLowStock();
}

window.criarNegocio = async function () {
  const name = document.getElementById('new-biz-name').value.trim();

  if (!name) {
    showToast('Digite um nome');
    return;
  }

  try {
    await addBusiness(name, state.user.uid);
    document.getElementById('new-biz-name').value = '';
    closeModal('modal-new-biz');
    await loadBusinesses();
    showToast('✅ Negócio criado!');
  } catch (e) {
    showToast('❌ Erro: ' + e.message);
  }
};

// Excluir negócio agora apaga também produtos, vendas e comprovantes
// (antes só o documento do negócio era removido e o resto ficava órfão).
window.deleteBusiness = function (id) {
  const biz = state.businesses.find(b => b.id === id);
  if (!biz) return;

  openBottomSheet('modal-del-biz', `
    <div class="bs-handle"></div>
    <div class="bs-header">
      <div class="bs-title-wrap">
        <div class="bs-icon bs-icon--brown"><i class="bi bi-trash3-fill"></i></div>
        <h3 class="bs-title">Excluir negócio</h3>
      </div>
      <button class="bs-close" aria-label="Fechar" onclick="closeBottomSheet('modal-del-biz')"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="bs-product-info">
      <span class="bs-product-name">${esc(biz.name)}</span>
    </div>
    <div class="bs-body">
      <p class="bs-hint">Isso apaga <strong>todos os produtos, vendas e comprovantes</strong> deste negócio e não pode ser desfeito. Digite o nome do negócio para confirmar.</p>
      <input type="text" id="del-biz-confirm" class="bs-input" placeholder="${esc(biz.name)}" autocomplete="off" />
    </div>
    <div class="bs-footer">
      <button class="bs-btn-cancel" onclick="closeBottomSheet('modal-del-biz')">Cancelar</button>
      <button class="bs-btn-confirm" id="btn-del-biz" onclick="confirmDeleteBusiness('${esc(id)}')"><i class="bi bi-trash3"></i> Excluir tudo</button>
    </div>
  `);
};

async function deleteCollectionDocs(colRef) {
  const snap = await getDocs(colRef);
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

window.confirmDeleteBusiness = async function (id) {
  const biz = state.businesses.find(b => b.id === id);
  if (!biz) return;

  const typed = (document.getElementById('del-biz-confirm')?.value || '').trim();
  if (typed.toLowerCase() !== biz.name.trim().toLowerCase()) {
    return showToast('❌ O nome digitado não confere');
  }

  await guarded(document.getElementById('btn-del-biz'), async () => {
    try {
      const uid = state.user.uid;
      // ⚠️ Se você tiver outras subcoleções dentro do negócio, inclua aqui
      // (os comprovantes são apagados logo abaixo, em deleteAllReceipts).
      for (const sub of ['products', 'sales']) {
        await deleteCollectionDocs(collection(db, 'users', uid, 'businesses', id, sub));
      }
      await deleteAllReceipts(uid, id);
      await deleteDoc(doc(db, 'users', uid, 'businesses', id));

      state.businesses = state.businesses.filter(b => b.id !== id);
      if (state.currentBiz?.id === id) state.currentBiz = null;

      closeBottomSheet('modal-del-biz');
      renderBusinessList();
      showToast('🗑️ Negócio e dados apagados');
    } catch (e) {
      console.error(e);
      showToast('❌ Erro ao deletar negócio');
    }
  });
};

// ===== NAV =====
window.navTo = function (page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  document.getElementById('page-' + page).classList.add('active');
  document.getElementById('nav-' + page).classList.add('active');

  if (page === 'produtos') renderProducts();
  if (page === 'vender') renderSellPage();
  if (page === 'historico') renderHistorico();
};

// ===== PRODUTOS =====
window.renderProducts = function () {
  const el = document.getElementById('product-list-container');
  const marcaSelect = document.getElementById('filter-marca');
  const categoriaSelect = document.getElementById('filter-categoria');

  // Guarda a seleção ANTES de reconstruir os <select>
  // (antes o valor era perdido a cada render e os filtros nunca funcionavam).
  const prevMarca = marcaSelect ? marcaSelect.value : '';
  const prevCat = categoriaSelect ? categoriaSelect.value : '';

  const marcas = Array.from(new Set(state.products.map(p => p.marca || 'N/A'))).sort();
  const categorias = Array.from(new Set(state.products.map(p => p.tipo || '').filter(Boolean))).sort();

  if (marcaSelect) {
    marcaSelect.innerHTML = '<option value="">Todas as marcas</option>' +
      marcas.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    marcaSelect.value = marcas.includes(prevMarca) ? prevMarca : '';
  }
  if (categoriaSelect) {
    categoriaSelect.innerHTML = '<option value="">Todas as categorias</option>' +
      categorias.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    categoriaSelect.value = categorias.includes(prevCat) ? prevCat : '';
  }

  if (!state.products.length) {
    el.innerHTML = `<p class="no-products-msg">Nenhum produto</p>`;
    return;
  }

  const searchTerm = (document.getElementById('search-produto')?.value || '').toLowerCase();
  const filterMarca = marcaSelect ? marcaSelect.value : '';
  const filterCat = categoriaSelect ? categoriaSelect.value : '';
  const quase = document.getElementById('filter-quase')?.checked || false;
  const esgotado = document.getElementById('filter-esgotado')?.checked || false;

  const filtered = state.products.filter(p => {
    const nameMatch = p.nome && p.nome.toLowerCase().includes(searchTerm);
    const marcaMatch = p.marca && p.marca.toLowerCase().includes(searchTerm);
    const tipoMatch = p.tipo && p.tipo.toLowerCase().includes(searchTerm);

    if (searchTerm && !(nameMatch || marcaMatch || tipoMatch)) return false;
    if (filterMarca && (p.marca || 'N/A') !== filterMarca) return false;
    if (filterCat && p.tipo !== filterCat) return false;
    if (esgotado && p.qtd !== 0) return false;
    if (quase && !(p.qtd <= 4 && p.qtd > 0)) return false;
    return true;
  });

  if (!filtered.length) {
    el.innerHTML = `<p class="no-products-msg">Nenhum produto encontrado com esses filtros</p>`;
    return;
  }

  el.innerHTML = filtered.map(p => `
      <div class="product-card">
        ${p.imageUrl
          ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.nome)}" class="product-image" />`
          : `<div class="product-thumb">📦</div>`}

        <div class="product-info">
          <strong>${esc(p.nome)}</strong>
          <small>${esc(p.marca || 'N/A')} • ${esc(p.tipo || '')}</small>
          <small>Estoque: ${esc(p.qtd)}</small>
        </div>

        <div class="product-actions">
          <button class="edit-btn" aria-label="Editar ${esc(p.nome)}" onclick="editarProduto('${esc(p.id)}')">✏️</button>
          <button class="restock-btn" aria-label="Repor estoque de ${esc(p.nome)}" title="Reposição de estoque" onclick="reporEstoque('${esc(p.id)}')">➕</button>
          <button class="delete-btn" aria-label="Deletar ${esc(p.nome)}" title="Deletar produto" onclick="deletarProduto('${esc(p.id)}')">🗑️</button>
        </div>
      </div>
    `).join('');
};

window.deletarProduto = async function (id) {
  if (!confirm("Deletar produto?")) return;

  try {
    await deleteProduct(state.currentBiz.id, state.user.uid, id);
    state.products = state.products.filter(p => p.id !== id);
    renderProducts();
    showToast("🗑️ Produto deletado");
  } catch (e) {
    console.error(e);
    showToast("❌ Erro ao deletar");
  }
};

window.reporEstoque = function (id) {
  const produto = state.products.find(p => p.id === id);
  if (!produto) return showToast('Produto não encontrado');

  openBottomSheet(`modal-repor-${id}`, `
    <div class="bs-handle"></div>
    <div class="bs-header">
      <div class="bs-title-wrap">
        <div class="bs-icon bs-icon--green"><i class="bi bi-plus-circle-fill"></i></div>
        <h3 class="bs-title">Repor Estoque</h3>
      </div>
      <button class="bs-close" aria-label="Fechar" onclick="closeBottomSheet('modal-repor-${esc(id)}')"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="bs-product-info">
      <span class="bs-product-name">${esc(produto.nome)}</span>
      <span class="bs-stock-badge">Estoque atual: <strong>${esc(produto.qtd)}</strong></span>
    </div>
    <div class="bs-body">
      <label class="bs-label" for="repor-qtd-${esc(id)}">Quantidade a adicionar</label>
      <div class="bs-qty-row">
        <button class="bs-qty-btn" aria-label="Diminuir" onclick="bsAdjustQty('repor-qtd-${esc(id)}',-1)"><i class="bi bi-dash"></i></button>
        <input type="number" id="repor-qtd-${esc(id)}" class="bs-qty-input" value="1" min="1" />
        <button class="bs-qty-btn" aria-label="Aumentar" onclick="bsAdjustQty('repor-qtd-${esc(id)}',1)"><i class="bi bi-plus"></i></button>
      </div>
    </div>
    <div class="bs-footer">
      <button class="bs-btn-cancel" onclick="closeBottomSheet('modal-repor-${esc(id)}')">Cancelar</button>
      <button class="bs-btn-confirm" id="btn-repor-${esc(id)}" onclick="confirmReporEstoque('${esc(id)}')"><i class="bi bi-check-lg"></i> Adicionar</button>
    </div>
  `);
};

window.confirmReporEstoque = async function (id) {
  const add = parseInt(document.getElementById(`repor-qtd-${id}`).value, 10);
  if (!Number.isInteger(add) || add <= 0) return showToast('Quantidade inválida');

  await guarded(document.getElementById(`btn-repor-${id}`), async () => {
    try {
      // increment(): soma no servidor, sem depender do estoque que está na tela
      await updateDoc(productRef(id), { qtd: increment(add) });
      // Estoque mudou: limpa as flags pra notificação poder disparar de novo no futuro
      clearStockNotificationFlags(id);
      closeBottomSheet(`modal-repor-${id}`);
      await loadProductsAndSales();
      showToast('✅ Estoque atualizado');
    } catch (e) {
      console.error(e);
      showToast('❌ Erro ao atualizar estoque');
    }
  });
};

window.editarProduto = function (id) {
  const produto = state.products.find(p => p.id === id);
  if (!produto) return;

  openBottomSheet(`modal-editar-${id}`, `
    <div class="bs-handle"></div>
    <div class="bs-header">
      <div class="bs-title-wrap">
        <div class="bs-icon bs-icon--gold"><i class="bi bi-pencil-fill"></i></div>
        <h3 class="bs-title">Editar Produto</h3>
      </div>
      <button class="bs-close" onclick="closeBottomSheet('modal-editar-${id}')"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="bs-body bs-scrollable">
      <label class="bs-label">Nome do produto <span class="bs-req">*</span></label>
      <input type="text" id="edit-nome" class="bs-input" value="${esc(produto.nome)}" />

      <div class="bs-row-2">
        <div>
          <label class="bs-label">Estoque <span class="bs-req">*</span></label>
          <input type="number" id="edit-qtd" class="bs-input" value="${produto.qtd}" min="0" />
        </div>
        <div>
          <label class="bs-label">Custo (R$) <span class="bs-req">*</span></label>
          <input type="number" id="edit-custo" class="bs-input" value="${produto.custo}" min="0" step="0.01" />
        </div>
      </div>

      <label class="bs-label">Marca</label>
      <input type="text" id="edit-marca" class="bs-input" value="${esc(produto.marca || '')}" />

      <label class="bs-label">Categoria</label>
      <div class="bs-select-wrap">
        <select id="edit-tipo" class="bs-input">
          <option value="">Selecione o tipo</option>
          <option ${produto.tipo === 'Cosmético' ? 'selected' : ''}>Cosmético</option>
          <option ${produto.tipo === 'Alimento' ? 'selected' : ''}>Alimento</option>
          <option ${produto.tipo === 'Eletrônico' ? 'selected' : ''}>Eletrônico</option>
          <option ${produto.tipo === 'Vestuário' ? 'selected' : ''}>Vestuário</option>
          <option ${produto.tipo === 'Outro' ? 'selected' : ''}>Outro</option>
        </select>
        <i class="bi bi-chevron-down"></i>
      </div>
    </div>
    <div class="bs-footer">
      <button class="bs-btn-cancel" onclick="closeBottomSheet('modal-editar-${id}')">Cancelar</button>
      <button class="bs-btn-confirm" onclick="salvarEdicaoProduto('${id}')"><i class="bi bi-check-lg"></i> Salvar</button>
    </div>
  `);
};

window.salvarEdicaoProduto = async function(id) {
  const novoNome = document.getElementById('edit-nome').value.trim();
  const novaQtd = parseInt(document.getElementById('edit-qtd').value);
  const novoCusto = parseFloat(document.getElementById('edit-custo').value);
  const novoMarca = document.getElementById('edit-marca').value.trim();
  const novoTipo = document.getElementById('edit-tipo').value.trim();

  if (!novoNome || !Number.isInteger(novaQtd) || novaQtd < 0 || isNaN(novoCusto) || novoCusto < 0) {
    showToast('❌ Preencha todos os campos corretamente');
    return;
  }

  try {
    await editarProdutoFirestore(id, {
      nome: novoNome,
      qtd: novaQtd,
      custo: novoCusto,
      marca: novoMarca || 'N/A',
      tipo: novoTipo || ''
    });

    closeBottomSheet(`modal-editar-${id}`);

  } catch (error) {
    console.error('Erro ao salvar edição:', error);
    showToast('❌ Erro ao salvar edição');
  }
};

async function editarProdutoFirestore(
  id,
  dados
) {

  try {

    await updateProduct(
      state.currentBiz.id,
      state.user.uid,
      id,
      dados
    );

    // Estoque pode ter mudado na edição: limpa as flags de notificação
    clearStockNotificationFlags(id);

    await loadProductsAndSales();

    showToast(
      "✏️ Produto atualizado"
    );

  } catch (e) {

    console.error(e);

    showToast(
      "❌ Erro ao editar"
    );
  }
}

// ===== STATS =====
window.updateStats = function () {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  document.getElementById('stat-produtos').textContent = state.products.length;

  const salesThisMonth = filterSalesByPeriod(state.sales, 'mes', now);
  const totalVendas = salesThisMonth.reduce((sum, sale) => sum + (parseFloat(sale.total || 0)), 0);
  document.getElementById('stat-vendas').textContent = 'R$ ' + totalVendas.toFixed(2).replace('.', ',');
  document.getElementById('stat-transacoes').textContent = salesThisMonth.length;

  // Usa o lucro gravado no momento da venda. Recalcular com o custo ATUAL do produto
  // mudava o histórico ao editar o custo e zerava o custo de produtos deletados.
  const lucroTotal = salesThisMonth.reduce((acc, sale) => {
    if (sale.lucro !== undefined && sale.lucro !== null && Number.isFinite(Number(sale.lucro))) {
      return acc + Number(sale.lucro);
    }
    // vendas muito antigas, sem lucro gravado
    let saleLucro = 0;
    (sale.itens || []).forEach(it => {
      const prod = state.products.find(p => p.id === it.produtoId);
      const custo = prod ? parseFloat(prod.custo || 0) : 0;
      saleLucro += (parseFloat(it.preco || 0) - custo) * parseInt(it.quantidade || 0, 10);
    });
    return acc + saleLucro;
  }, 0);

  document.getElementById('stat-lucro').textContent = 'R$ ' + lucroTotal.toFixed(2).replace('.', ',');

  const dizimo = lucroTotal * 0.1;
  const dizimoEl = document.getElementById('stat-dizimo');
  if (dizimoEl) {
    dizimoEl.textContent = 'R$ ' + dizimo.toFixed(2).replace('.', ',');
  }

  const historyList = document.getElementById('monthly-history-list');
  if (historyList) {
    const months = summarizeSalesByMonth(state.sales, state.products).slice(0, 6);
    historyList.innerHTML = months.length
      ? months.map((item) => `
          <div class="monthly-history-item">
            <div>
              <strong>${item.label}</strong>
              <span>${item.transactions} venda(s)</span>
            </div>
            <div class="monthly-history-values">
              <span>R$ ${item.total.toFixed(2).replace('.', ',')}</span>
              <small>Lucro R$ ${item.lucro.toFixed(2).replace('.', ',')}</small>
            </div>
          </div>
        `).join('')
      : '<p class="no-products-msg">Ainda não há vendas registradas.</p>';
  }
};

// ===== TOAST =====
window.showToast = function (msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
};

// ===== MODAL =====
window.openModal = function (id) {
  document.getElementById(id).classList.add('open');
};

window.closeModal = function (id) {
  document.getElementById(id).classList.remove('open');
};

document.getElementById("google-login").onclick = async () => {
  try {
    await loginGoogle();
  } catch (e) {
    console.error(e);
    alert(e.code + "\n\n" + e.message);
  }
};

// ===== PRODUTOS: ADICIONAR =====
window.adicionarProduto = async function () {
  const nome = document.getElementById('add-nome').value.trim();
  const custo = parseFloat(document.getElementById('add-custo').value);
  const qtd = parseInt(document.getElementById('add-qtd').value, 10);
  const tipo = document.getElementById('add-tipo').value.trim();
  const marca = document.getElementById('add-marca').value.trim();
  const imageFile = document.getElementById('product-image').files[0];

  if (!nome || isNaN(custo) || custo < 0 || !Number.isInteger(qtd) || qtd < 0 || !tipo) {
    showToast('❌ Preencha todos os campos obrigatórios');
    return;
  }

  await guarded(document.getElementById('btn-adicionar-produto'), async () => {
    try {
      // imageUrl é local: antes era global e a foto de um produto vazava para o próximo
      let imageUrl = '';
      if (imageFile) {
        showToast('⏳ Enviando imagem...');
        imageUrl = await uploadProductImage(imageFile);
      }

      await addProduct(state.currentBiz.id, state.user.uid, {
        nome,
        custo,
        qtd,
        tipo,
        marca: marca || 'N/A',
        imageUrl
      });

      resetPhotoUpload();
      document.getElementById('add-nome').value = '';
      document.getElementById('add-custo').value = '';
      document.getElementById('add-qtd').value = '';
      document.getElementById('add-tipo').value = '';
      document.getElementById('add-marca').value = '';
      document.getElementById('product-image').value = '';

      await loadProductsAndSales();

      navTo('produtos');
      showToast('✅ Produto adicionado com sucesso!');
      maybeAskNotifications();
    } catch (e) {
      showToast('❌ Erro ao adicionar: ' + e.message);
    }
  });
};

// ===== VENDER: CARRINHO =====
// Cada linha do carrinho é produto + preço: o mesmo produto pode entrar com preços
// diferentes sem reprecificar as unidades que já estavam no carrinho.
const cartQtyOf = (productId) =>
  state.cart.filter(c => c.id === productId).reduce((sum, c) => sum + c.quantidade, 0);

window.addToCart = function () {
  const selectEl = document.getElementById('sell-product-select');
  const productId = selectEl.value;

  if (!productId) return;

  const product = state.products.find(p => p.id === productId);
  if (!product) return showToast('Produto não encontrado');

  const disponivel = product.qtd - cartQtyOf(productId);
  if (disponivel <= 0) {
    selectEl.value = '';
    return showToast('❌ Sem estoque disponível');
  }

  const modalId = `modal-add-cart-${productId}`;
  if (document.getElementById(modalId)) return; // evita abrir duplicado

  const closeJs = `closeBottomSheet('${esc(modalId)}'); document.getElementById('sell-product-select').value = '';`;

  openBottomSheet(modalId, `
    <div class="bs-handle"></div>
    <div class="bs-header">
      <div class="bs-title-wrap">
        <div class="bs-icon bs-icon--gold"><i class="bi bi-cart-plus-fill"></i></div>
        <h3 class="bs-title">Adicionar ao Carrinho</h3>
      </div>
      <button class="bs-close" aria-label="Fechar" onclick="${closeJs}"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="bs-product-info">
      <span class="bs-product-name">${esc(product.nome)}</span>
      <span class="bs-stock-badge">Disponível: <strong>${disponivel} un.</strong></span>
    </div>
    <div class="bs-body">
      <label class="bs-label" for="cart-qty-${esc(productId)}">Quantidade</label>
      <div class="bs-qty-row">
        <button class="bs-qty-btn" aria-label="Diminuir" onclick="bsAdjustQty('cart-qty-${esc(productId)}',-1)"><i class="bi bi-dash"></i></button>
        <input type="number" id="cart-qty-${esc(productId)}" class="bs-qty-input" value="1" min="1" max="${disponivel}" />
        <button class="bs-qty-btn" aria-label="Aumentar" onclick="bsAdjustQty('cart-qty-${esc(productId)}',1)"><i class="bi bi-plus"></i></button>
      </div>
      <label class="bs-label" style="margin-top:16px" for="cart-price-${esc(productId)}">Preço de venda por unidade (R$) <span class="bs-req">*</span></label>
      <input type="number" id="cart-price-${esc(productId)}" class="bs-input" min="0.01" step="0.01" inputmode="decimal" placeholder="0,00" />
    </div>
    <div class="bs-footer">
      <button class="bs-btn-cancel" onclick="${closeJs}">Cancelar</button>
      <button class="bs-btn-confirm" onclick="confirmAddToCart('${esc(productId)}', '${esc(modalId)}')"><i class="bi bi-cart-check-fill"></i> Adicionar</button>
    </div>
  `);

  setTimeout(() => document.getElementById(`cart-price-${productId}`)?.focus(), 100);
};

window.confirmAddToCart = function (productId, modalId) {
  const product = state.products.find(p => p.id === productId);
  if (!product) return showToast('Produto não encontrado');

  const qty = parseInt(document.getElementById(`cart-qty-${productId}`).value || '0', 10);
  const price = round2(parseFloat(String(document.getElementById(`cart-price-${productId}`).value).replace(',', '.') || '0'));

  if (!qty || qty <= 0) return showToast('❌ Quantidade inválida');
  if (isNaN(price) || price <= 0) return showToast('❌ Preço inválido');
  if (cartQtyOf(productId) + qty > product.qtd) return showToast('❌ Estoque insuficiente');

  const lineId = `${productId}@${price}`;
  const line = state.cart.find(c => c.lineId === lineId);
  if (line) {
    line.quantidade += qty;
  } else {
    state.cart.push({ lineId, id: product.id, nome: product.nome, preco: price, quantidade: qty });
  }

  closeBottomSheet(modalId);
  document.getElementById('sell-product-select').value = '';
  renderCart();
  showToast('✅ Produto adicionado ao carrinho');
};

// ===== VENDER: RENDERIZAR PÁGINA =====
window.filterSellProducts = function () {
  const search = document.getElementById('search-sell-product')?.value.toLowerCase() || '';
  const resultsEl = document.getElementById('sell-product-results');
  const selectEl = document.getElementById('sell-product-select');

  if (!resultsEl || !selectEl) return;

  const filtered = state.products.filter((product) => {
    const haystack = `${product.nome || ''} ${product.marca || ''} ${product.tipo || ''}`.toLowerCase();
    return haystack.includes(search) || search === '';
  });

  if (!search) {
    resultsEl.innerHTML = '<div class="sell-product-empty">Digite para buscar produtos disponíveis.</div>';
    return;
  }

  if (!filtered.length) {
    resultsEl.innerHTML = '<div class="sell-product-empty">Nenhum produto encontrado.</div>';
    return;
  }

  resultsEl.innerHTML = filtered.map((product) => `
    <button type="button" class="sell-product-chip" onclick="selectSellProduct('${product.id}')">
      <strong>${esc(product.nome)}</strong>
      <span>${esc(product.qtd)} em estoque • ${esc(product.marca || 'Sem marca')}</span>
    </button>
  `).join('');
};

window.selectSellProduct = function (productId) {
  const selectEl = document.getElementById('sell-product-select');
  const searchEl = document.getElementById('search-sell-product');
  const product = state.products.find((item) => item.id === productId);

  if (!selectEl || !product) return;

  selectEl.value = productId;
  if (searchEl) {
    searchEl.value = product.nome;
  }

  document.getElementById('sell-product-results').innerHTML = '';
  addToCart();
};

window.renderSellPage = function () {
  const selectEl = document.getElementById('sell-product-select');
  const searchEl = document.getElementById('search-sell-product');
  const resultsEl = document.getElementById('sell-product-results');

  selectEl.innerHTML = '<option value="">Selecione um produto</option>';

  state.products.forEach(p => {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = `${p.nome} (${p.qtd} em estoque) - ${p.marca || ''}`;
    selectEl.appendChild(option);
  });

  if (searchEl) {
    searchEl.value = '';
  }

  if (resultsEl) {
    resultsEl.innerHTML = '<div class="sell-product-empty">Digite para buscar produtos disponíveis.</div>';
  }

  renderCart();
  window.filterSellProducts();
};

// ===== VENDER: RENDERIZAR CARRINHO =====
window.renderCart = function () {
  const cartList = document.getElementById('cart-list');
  const summaryWrap = document.getElementById('cart-summary-wrap');

  if (state.cart.length === 0) {
    cartList.innerHTML = '<p class="no-products-msg">Nenhum produto adicionado</p>';
    summaryWrap.style.display = 'none';
    return;
  }

  let subtotal = 0;
  cartList.innerHTML = state.cart.map(item => {
    subtotal += item.preco * item.quantidade;
    return `
      <div class="cart-item">
        <div class="cart-item-info">
          <strong>${esc(item.nome)}</strong>
          <span class="cart-item-price">${brl(item.preco)} x${item.quantidade}</span>
        </div>
        <div class="cart-item-controls">
          <button class="cart-btn" aria-label="Diminuir quantidade" onclick="changeCartQty('${esc(item.lineId)}', -1)">-</button>
          <span>${item.quantidade}</span>
          <button class="cart-btn" aria-label="Aumentar quantidade" onclick="changeCartQty('${esc(item.lineId)}', 1)">+</button>
        </div>
      </div>
    `;
  }).join('');

  subtotal = round2(subtotal);
  document.getElementById('summary-sub').textContent = brl(subtotal);
  document.getElementById('summary-total').textContent = brl(subtotal);
  summaryWrap.style.display = 'block';
};

// "−" diminui de 1 (e remove a linha ao chegar em zero); antes removia a linha inteira.
window.changeCartQty = function (lineId, delta) {
  const line = state.cart.find(c => c.lineId === lineId);
  if (!line) return;

  if (delta > 0) {
    const product = state.products.find(p => p.id === line.id);
    if (!product || cartQtyOf(line.id) + delta > product.qtd) {
      return showToast('❌ Quantidade indisponível');
    }
    line.quantidade += delta;
  } else {
    line.quantidade += delta;
    if (line.quantidade <= 0) state.cart = state.cart.filter(c => c !== line);
  }
  renderCart();
};

// ===== COMPROVANTES: campo de arquivo =====
// Qual forma de pagamento REALMENTE recebeu dinheiro agora? (null = fiado ainda não pago)
function getEffectiveReceivedMethod() {
  const method = document.querySelector('input[name="payment-method"]:checked')?.value;
  if (!method) return null;
  if (method !== 'fiado') return method;
  const status = document.querySelector('input[name="fiado-status"]:checked')?.value;
  if (status !== 'pago') return null;
  return document.querySelector('input[name="fiado-payment"]:checked')?.value || null;
}

function resetReceiptInput(input) {
  if (!input) return;
  input.value = '';
  const box = input.closest('.receipt-upload');
  const label = box?.querySelector('span');
  if (label) label.textContent = label.dataset.default || 'Anexar comprovante';
  box?.classList.remove('has-file');
}

window.onReceiptPicked = function (input) {
  const file = input.files[0];
  const box = input.closest('.receipt-upload');
  const label = box.querySelector('span');

  if (!file) return resetReceiptInput(input);

  const error = validateReceiptFile(file);
  if (error) {
    showToast('❌ ' + error);
    return resetReceiptInput(input);
  }
  label.textContent = file.name;
  box.classList.add('has-file');
};

// Mostra o campo de comprovante só quando o dinheiro entrou via PIX.
window.updateSaleReceiptVisibility = function () {
  const wrap = document.getElementById('sale-receipt-wrap');
  if (!wrap) return;
  const show = getEffectiveReceivedMethod() === 'pix';
  wrap.style.display = show ? 'block' : 'none';
  if (!show) resetReceiptInput(document.getElementById('sale-receipt-file'));
};

// ===== VENDER: FINALIZAR VENDA =====
window.finalizarVenda = async function () {
  const clientName = document.getElementById('client-name').value.trim();
  const clientPhone = document.getElementById('client-phone').value.trim();
  const firstBuy = document.getElementById('first-buy').checked;

  const paymentMethod = document.querySelector('input[name="payment-method"]:checked')?.value;
  let fiadoStatus = null;
  let fiadoPaymentMethod = null;

  if (paymentMethod === 'fiado') {
    fiadoStatus = document.querySelector('input[name="fiado-status"]:checked').value;
    if (fiadoStatus === 'pago') {
      fiadoPaymentMethod = document.querySelector('input[name="fiado-payment"]:checked').value;
    }
  }

  if (!clientName) return showToast('❌ Digite o nome do cliente');
  if (!paymentMethod) return showToast('❌ Selecione um método de pagamento');
  if (state.cart.length === 0) return showToast('❌ Adicione produtos ao carrinho');

  const receivedMethod = getEffectiveReceivedMethod();
  const receiptFile = document.getElementById('sale-receipt-file')?.files[0] || null;

  // PIX recebido agora ⇒ comprovante obrigatório
  if (receivedMethod === 'pix') {
    if (!receiptFile) return showToast('❌ Anexe o comprovante do PIX');
    const fileError = validateReceiptFile(receiptFile);
    if (fileError) return showToast('❌ ' + fileError);
  }

  await guarded(document.getElementById('btn-finalizar-venda'), async () => {
    const saleRef = doc(bizCol('sales'));
    let receipt = null;

    try {
      if (receivedMethod === 'pix') {
        showToast('⏳ Enviando comprovante...');
        receipt = await uploadReceipt(receiptFile, {
          uid: state.user.uid,
          bizId: state.currentBiz.id,
          saleId: saleRef.id
        });
      }

      const pagoAgora = paymentMethod !== 'fiado' || fiadoStatus === 'pago';
      const now = new Date();
      const cart = state.cart.map(c => ({ ...c }));

      // Transação: confere o estoque ATUAL no servidor, baixa o estoque e grava a venda
      // de uma vez. Se qualquer parte falhar, nada é salvo (sem venda sem baixa, sem
      // estoque desatualizado quando há dois aparelhos/abas).
      await runTransaction(db, async (tx) => {
        const productIds = [...new Set(cart.map(c => c.id))];
        const snaps = await Promise.all(productIds.map(pid => tx.get(productRef(pid))));

        const prods = {};
        snaps.forEach((snap, i) => {
          if (!snap.exists()) {
            throw new Error('Produto não encontrado: ' + cart.find(c => c.id === productIds[i]).nome);
          }
          prods[productIds[i]] = snap.data();
        });

        const need = {};
        cart.forEach(c => { need[c.id] = (need[c.id] || 0) + c.quantidade; });
        for (const pid of productIds) {
          if ((prods[pid].qtd || 0) < need[pid]) {
            throw new Error(`Estoque insuficiente para ${prods[pid].nome}`);
          }
        }

        let total = 0;
        let totalLucro = 0;
        const items = cart.map(c => {
          const custo = parseFloat(prods[c.id].custo || 0);
          const subtotal = round2(c.preco * c.quantidade);
          const lucro = round2((c.preco - custo) * c.quantidade);
          total += subtotal;
          totalLucro += lucro;
          return {
            produtoId: c.id,
            nome: c.nome,
            preco: c.preco,
            quantidade: c.quantidade,
            subtotal,
            lucro
          };
        });
        total = round2(total);
        totalLucro = round2(totalLucro);

        // Histórico de pagamentos: cada entrada tem valor, data, forma e comprovante.
        const pagamentos = pagoAgora ? [{
          valor: total,
          data: now.toISOString(),
          registradoEm: now.toISOString(),
          metodo: receivedMethod,
          comprovantePath: receipt?.path || null,
          comprovanteTipo: receipt?.tipo || null
        }] : [];

        const sale = {
          cliente: clientName,
          telefone: clientPhone || 'N/A',
          primeiraCompra: firstBuy,
          itens: items,
          total,
          lucro: totalLucro,
          data: now.toLocaleString('pt-BR'),
          metodoPagamento: paymentMethod,
          fiadoStatus,
          fiadoPaymentMethod,
          pago: pagoAgora,
          // Antes todo fiado nascia com valorPago 0 / saldo total, mesmo "já pago".
          valorPago: pagoAgora ? total : 0,
          saldoRestante: pagoAgora ? 0 : total,
          pagamentos,
          // parseSaleDate() lê estes campos para ordenar e filtrar (mesmo que o addSale() gravava)
          createdAt: serverTimestamp(),
          saleDate: serverTimestamp()
        };
        if (pagoAgora && paymentMethod === 'fiado') {
          sale.dataPagamento = now.toLocaleDateString('pt-BR');
        }

        productIds.forEach(pid => {
          tx.update(productRef(pid), { qtd: (prods[pid].qtd || 0) - need[pid] });
        });
        tx.set(saleRef, sale);
      });

      // Limpar formulário
      state.cart = [];
      document.getElementById('client-name').value = '';
      document.getElementById('client-phone').value = '';
      document.getElementById('first-buy').checked = false;
      document.querySelector('input[name="payment-method"][value="especie"]').checked = true;
      document.querySelector('input[name="fiado-status"][value="nao-pago"]').checked = true;
      document.querySelector('input[name="fiado-payment"][value="especie"]').checked = true;
      document.getElementById('fiado-options').style.display = 'none';
      document.getElementById('fiado-payment-method').style.display = 'none';
      updateSaleReceiptVisibility();

      renderCart();
      await loadProductsAndSales();

      showToast('✅ Venda registrada com sucesso!');
      navTo('produtos');
      maybeAskNotifications();
    } catch (e) {
      console.error(e);
      if (receipt) deleteReceipt(receipt.path); // não deixa comprovante órfão
      showToast('❌ Erro ao finalizar venda: ' + e.message);
    }
  });
};

// ===== HISTÓRICO =====
function getSaleBalance(sale) {
  if (sale.metodoPagamento !== 'fiado') return 0;
  if (sale.pago === true) return 0; // venda quitada nunca tem saldo (corrige fiado "já pago")
  return Math.max(0, round2(Number(sale.total || 0) - Number(sale.valorPago || 0)));
}

function getPaymentMethodLabel(sale) {
  if (sale.metodoPagamento === 'fiado') {
    const balance = getSaleBalance(sale);
    if (balance <= 0) return 'Fiado (Quitado)';
    return `Fiado (${brl(balance)} restante)`;
  }
  return METHOD_LABEL[sale.metodoPagamento] || sale.metodoPagamento || '—';
}

window.renderHistorico = function () {
  const historicoList = document.getElementById('historico-list');
  const searchTerm = document.getElementById('search-historico')?.value.toLowerCase() || '';

  let filtered = state.sales.filter(s =>
    (s.cliente || '').toLowerCase().includes(searchTerm)
  );

  if (state.histFilter !== 'todas') {
    filtered = filterSalesByPeriod(filtered, state.histFilter, new Date());
  }

  if (state.saleTypeFilter !== 'todas') {
    filtered = filtered.filter(s => {
      switch (state.saleTypeFilter) {
        case 'fiado': return getSaleBalance(s) > 0;
        case 'pagas': return s.pago === true;
        default: return true;
      }
    });
  }

  if (filtered.length === 0) {
    historicoList.innerHTML = '<p class="no-products-msg">Nenhuma venda encontrada</p>';
    return;
  }

  historicoList.innerHTML = filtered.map(sale => {
    const saldoRestante = getSaleBalance(sale);
    const isOpenFiado = sale.metodoPagamento === 'fiado' && saldoRestante > 0;
    const id = esc(sale.id);

    return `
      <div class="historico-item ${isOpenFiado ? 'fiado' : ''}">
        <div class="historico-header">
          <strong>${esc(sale.cliente)}</strong>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end;">
            ${isOpenFiado ? '<span class="fiado-badge">Fiado</span>' : ''}
            ${sale.pago ? '<span class="pago-badge">Pago</span>' : ''}
            <span class="historico-total">${brl(sale.total)}</span>
          </div>
        </div>
        <div class="historico-meta">
          <span>${esc(sale.data || (parseSaleDate(sale)?.toLocaleString('pt-BR') || ''))}</span>
          <span>${(sale.itens || []).length} item(ns)</span>
          <span>Método: ${esc(getPaymentMethodLabel(sale))}</span>
          ${isOpenFiado ? `<span class="badge-novo">Saldo: ${brl(saldoRestante)}</span>` : ''}
          ${isOpenFiado && Number(sale.valorPago) > 0 ? `<span class="badge-novo">Recebido: ${brl(sale.valorPago)}</span>` : ''}
          ${sale.primeiraCompra ? '<span class="badge-novo">Primeira compra</span>' : ''}
        </div>
        <div class="historico-itens">
          ${(sale.itens || []).map(item => `
            <span>${esc(item.nome)} (x${esc(item.quantidade)})</span>
          `).join('')}
        </div>
        <div class="historico-actions">
          <strong style="margin-right:8px">Lucro: ${brl(sale.lucro)}</strong>
          ${sale.telefone && sale.telefone !== 'N/A' ? `<button class="btn-link" onclick="showClientPhone('${id}')">📞 Ver telefone</button>` : ''}
          ${isOpenFiado ? `<button class="btn-link" onclick="abaterVendaFiada('${id}')">💰 Abater valor</button>` : ''}
          ${isOpenFiado ? `<button class="btn-link" onclick="abaterVendaFiada('${id}', true)">✅ Marcar como pago</button>` : ''}
          <button class="btn-link" onclick="viewSaleDetails('${id}')">🔎 Ver detalhes</button>
          <button class="btn-link danger" onclick="excluirVenda('${id}')">🗑️ Excluir</button>
        </div>
      </div>
    `;
  }).join('');
};

// ----- Excluir venda (com opção de devolver o estoque) -----
window.excluirVenda = function (saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return showToast('Venda não encontrada');

  openBottomSheet('modal-excluir-venda', `
    <div class="bs-handle"></div>
    <div class="bs-header">
      <div class="bs-title-wrap">
        <div class="bs-icon bs-icon--brown"><i class="bi bi-trash3-fill"></i></div>
        <h3 class="bs-title">Excluir venda</h3>
      </div>
      <button class="bs-close" aria-label="Fechar" onclick="closeBottomSheet('modal-excluir-venda')"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="bs-product-info">
      <span class="bs-product-name">${esc(sale.cliente)}</span>
      <span class="bs-stock-badge">${brl(sale.total)}</span>
    </div>
    <div class="bs-body">
      <p class="bs-hint">Os comprovantes anexados a esta venda também serão apagados. O que fazer com o estoque dos itens vendidos?</p>
    </div>
    <div class="bs-footer">
      <div class="bs-btn-stack">
        <button class="bs-btn-confirm" id="btn-excluir-devolver" onclick="confirmExcluirVenda('${esc(saleId)}', true)">Excluir e devolver ao estoque</button>
        <button class="bs-btn-cancel" onclick="confirmExcluirVenda('${esc(saleId)}', false)">Excluir sem mexer no estoque</button>
        <button class="bs-btn-cancel" onclick="closeBottomSheet('modal-excluir-venda')">Cancelar</button>
      </div>
    </div>
  `);
};

window.confirmExcluirVenda = async function (saleId, devolverEstoque) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return showToast('Venda não encontrada');

  await guarded(document.getElementById('btn-excluir-devolver'), async () => {
    try {
      await runTransaction(db, async (tx) => {
        let snaps = [];
        const need = {};
        if (devolverEstoque) {
          (sale.itens || []).forEach(it => {
            need[it.produtoId] = (need[it.produtoId] || 0) + Number(it.quantidade || 0);
          });
          const ids = Object.keys(need);
          snaps = await Promise.all(ids.map(pid => tx.get(productRef(pid))));
        }
        snaps.forEach(snap => {
          // produto já deletado: nada a devolver
          if (snap.exists()) tx.update(snap.ref, { qtd: (snap.data().qtd || 0) + need[snap.id] });
        });
        tx.delete(saleRefOf(saleId));
      });

      (sale.pagamentos || []).forEach(p => deleteReceipt(p.comprovantePath));

      state.sales = state.sales.filter(s => s.id !== saleId);
      closeBottomSheet('modal-excluir-venda');
      if (devolverEstoque) await loadProductsAndSales();
      renderHistorico();
      updateStats();
      showToast('🗑️ Venda removida');
    } catch (error) {
      console.error('Erro ao excluir venda:', error);
      showToast('❌ Erro ao excluir venda');
    }
  });
};

// ----- Detalhes da venda (inclui histórico de pagamentos e comprovantes) -----
window.viewSaleDetails = function (saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return showToast('Venda não encontrada');

  const itensList = (sale.itens || []).map(it => `
    <div class="bs-sale-item">
      <div class="bs-sale-item-info">
        <strong>${esc(it.nome)}</strong>
        <span>${esc(it.quantidade)}x — ${brl(it.preco)}/un.</span>
      </div>
      <div class="bs-sale-item-values">
        <span>${brl(it.subtotal)}</span>
        <span class="bs-sale-lucro">+${brl(it.lucro)}</span>
      </div>
    </div>
  `).join('');

  const pagamentos = Array.isArray(sale.pagamentos) ? sale.pagamentos : [];
  const saldo = getSaleBalance(sale);

  let pagamentosHtml;
  if (pagamentos.length) {
    pagamentosHtml = pagamentos.map((p, i) => `
      <div class="bs-sale-item">
        <div class="bs-sale-item-info">
          <strong>${brl(p.valor)}</strong>
          <span>${esc(fmtDate(p.data))} • ${esc(METHOD_LABEL[p.metodo] || p.metodo || '—')}</span>
        </div>
        <div class="bs-sale-item-values">
          ${p.comprovantePath
            ? `<button class="btn-link" onclick="viewReceipt('${esc(sale.id)}', ${i})">🧾 Ver comprovante</button>`
            : (p.metodo === 'pix' ? '<span class="receipt-missing">Sem comprovante</span>' : '')}
        </div>
      </div>
    `).join('');
  } else if (Number(sale.valorPago) > 0) {
    pagamentosHtml = `<p class="bs-hint">Venda anterior ao histórico de pagamentos: já recebido ${brl(sale.valorPago)}${sale.dataPagamento ? ` (último pagamento em ${esc(sale.dataPagamento)})` : ''}.</p>`;
  } else {
    pagamentosHtml = '<p class="bs-hint">Nenhum pagamento recebido ainda.</p>';
  }

  openBottomSheet('modal-detalhes-venda', `
    <div class="bs-handle"></div>
    <div class="bs-header">
      <div class="bs-title-wrap">
        <div class="bs-icon bs-icon--brown"><i class="bi bi-receipt"></i></div>
        <h3 class="bs-title">Detalhes da Venda</h3>
      </div>
      <button class="bs-close" aria-label="Fechar" onclick="closeBottomSheet('modal-detalhes-venda')"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="bs-body bs-scrollable">
      <div class="bs-detail-grid">
        <div class="bs-detail-item"><span>Cliente</span><strong>${esc(sale.cliente)}</strong></div>
        <div class="bs-detail-item"><span>Data</span><strong>${esc(sale.data)}</strong></div>
        <div class="bs-detail-item"><span>Método</span><strong>${esc(getPaymentMethodLabel(sale))}</strong></div>
        <div class="bs-detail-item"><span>Telefone</span><strong>${esc(sale.telefone || 'N/A')}</strong></div>
      </div>
      <div class="bs-totals-row">
        <div class="bs-total-box bs-total-box--gold">
          <span>Total</span>
          <strong>${brl(sale.total)}</strong>
        </div>
        <div class="bs-total-box bs-total-box--green">
          <span>Lucro</span>
          <strong>${brl(sale.lucro)}</strong>
        </div>
      </div>
      <div class="bs-section-title"><i class="bi bi-box-seam"></i> Itens</div>
      <div class="bs-sale-items">${itensList}</div>
      <div class="bs-section-title"><i class="bi bi-cash-stack"></i> Pagamentos${saldo > 0 ? ` — saldo ${brl(saldo)}` : ''}</div>
      <div class="bs-sale-items">${pagamentosHtml}</div>
    </div>
    <div class="bs-footer">
      <button class="bs-btn-confirm" onclick="closeBottomSheet('modal-detalhes-venda')">Fechar</button>
    </div>
  `);
};

window.viewReceipt = async function (saleId, index) {
  const sale = state.sales.find(s => s.id === saleId);
  const pagamento = sale?.pagamentos?.[index];
  if (!pagamento?.comprovantePath) return showToast('Comprovante não encontrado');

  try {
    showToast('⏳ Abrindo comprovante...');
    const url = await getReceiptUrl(pagamento.comprovantePath);
    const isPdf = pagamento.comprovanteTipo === 'application/pdf';

    openBottomSheet('modal-comprovante', `
      <div class="bs-handle"></div>
      <div class="bs-header">
        <div class="bs-title-wrap">
          <div class="bs-icon bs-icon--green"><i class="bi bi-receipt-cutoff"></i></div>
          <h3 class="bs-title">Comprovante</h3>
        </div>
        <button class="bs-close" aria-label="Fechar" onclick="closeBottomSheet('modal-comprovante')"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="bs-product-info">
        <span class="bs-product-name">${brl(pagamento.valor)} • ${esc(fmtDate(pagamento.data))}</span>
        <span class="bs-stock-badge">${esc(METHOD_LABEL[pagamento.metodo] || pagamento.metodo || '')}</span>
      </div>
      <div class="bs-body bs-scrollable" style="text-align:center">
        ${isPdf ? '' : `<img class="receipt-img" src="${esc(url)}" alt="Comprovante de pagamento" />`}
        <a class="btn-link" href="${esc(url)}" target="_blank" rel="noopener">Abrir em nova aba</a>
      </div>
      <div class="bs-footer">
        <button class="bs-btn-confirm" onclick="closeBottomSheet('modal-comprovante')">Fechar</button>
      </div>
    `);
  } catch (e) {
    console.error(e);
    showToast('❌ Não foi possível abrir o comprovante');
  }
};

window.showClientPhone = function (saleId) {
  const phone = state.sales.find(s => s.id === saleId)?.telefone;
  if (!phone || phone === 'N/A') return;

  openBottomSheet('modal-phone', `
    <div class="bs-handle"></div>
    <div class="bs-header">
      <div class="bs-title-wrap">
        <div class="bs-icon bs-icon--green"><i class="bi bi-telephone-fill"></i></div>
        <h3 class="bs-title">Telefone do Cliente</h3>
      </div>
      <button class="bs-close" aria-label="Fechar" onclick="closeBottomSheet('modal-phone')"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="bs-body" style="text-align:center; padding: 24px 20px;">
      <a href="tel:${esc(phone)}" class="bs-phone-display">
        <i class="bi bi-telephone-fill"></i> ${esc(phone)}
      </a>
      <p style="margin-top:14px; color:var(--gray); font-size:13px;">Toque para ligar direto</p>
    </div>
    <div class="bs-footer">
      <button class="bs-btn-confirm" onclick="closeBottomSheet('modal-phone')">Fechar</button>
    </div>
  `);
};

// ----- Abatimento de fiado: valor + data + forma + comprovante (PIX) -----
// quitar = true → "Marcar como pago": valor travado no saldo restante.
window.abaterVendaFiada = function (saleId, quitar = false) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return;

  const saldo = getSaleBalance(sale);
  if (saldo <= 0) return showToast('Esta venda já está quitada');

  const hoje = todayISODate();

  openBottomSheet('modal-abater-fiado', `
    <div class="bs-handle"></div>
    <div class="bs-header">
      <div class="bs-title-wrap">
        <div class="bs-icon bs-icon--green"><i class="bi bi-cash-stack"></i></div>
        <h3 class="bs-title">${quitar ? 'Marcar como pago' : 'Abater valor'}</h3>
      </div>
      <button class="bs-close" aria-label="Fechar" onclick="closeBottomSheet('modal-abater-fiado')"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="bs-product-info">
      <span class="bs-product-name">${esc(sale.cliente)}</span>
      <span class="bs-stock-badge">Saldo restante: <strong>${brl(saldo)}</strong></span>
    </div>
    <div class="bs-body bs-scrollable">
      <label class="bs-label" for="abater-valor">Valor recebido (R$)</label>
      <input type="number" id="abater-valor" class="bs-input" min="0.01" max="${saldo}" step="0.01" inputmode="decimal"
             placeholder="0,00" value="${quitar ? saldo.toFixed(2) : ''}" ${quitar ? 'readonly' : ''} />

      <label class="bs-label" for="abater-data" style="margin-top:12px">Data do pagamento</label>
      <input type="date" id="abater-data" class="bs-input" value="${hoje}" max="${hoje}" />

      <label class="bs-label" for="abater-payment-method" style="margin-top:12px">Como foi pago?</label>
      <div class="bs-select-wrap">
        <select id="abater-payment-method" class="bs-input" onchange="onAbaterMethodChange()">
          <option value="especie">💵 Espécie</option>
          <option value="cartao">💳 Cartão</option>
          <option value="pix">📱 PIX</option>
        </select>
        <i class="bi bi-chevron-down"></i>
      </div>

      <div id="abater-receipt-wrap" style="display:none; margin-top:12px">
        <label class="bs-label">Comprovante do PIX <span class="bs-req">*</span></label>
        <label class="receipt-upload">
          <i class="bi bi-paperclip"></i>
          <span data-default="Anexar comprovante (imagem ou PDF)">Anexar comprovante (imagem ou PDF)</span>
          <input type="file" id="abater-receipt-file" accept="image/*,application/pdf" onchange="onReceiptPicked(this)" />
        </label>
      </div>
    </div>
    <div class="bs-footer">
      <button class="bs-btn-cancel" onclick="closeBottomSheet('modal-abater-fiado')">Cancelar</button>
      <button class="bs-btn-confirm bs-btn-confirm--green" id="btn-confirm-abater" onclick="confirmarAbatimentoVenda('${esc(saleId)}')"><i class="bi bi-check-lg"></i> ${quitar ? 'Confirmar pagamento' : 'Registrar abatimento'}</button>
    </div>
  `);
};

window.onAbaterMethodChange = function () {
  const isPix = document.getElementById('abater-payment-method').value === 'pix';
  document.getElementById('abater-receipt-wrap').style.display = isPix ? 'block' : 'none';
  if (!isPix) resetReceiptInput(document.getElementById('abater-receipt-file'));
};

window.confirmarAbatimentoVenda = async function (saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return showToast('Venda não encontrada');

  const valor = round2(parseFloat(String(document.getElementById('abater-valor').value).replace(',', '.') || '0'));
  const dataStr = document.getElementById('abater-data').value;
  const metodo = document.getElementById('abater-payment-method').value;
  const file = document.getElementById('abater-receipt-file')?.files[0] || null;

  if (isNaN(valor) || valor <= 0) return showToast('❌ Digite um valor válido');
  if (!dataStr) return showToast('❌ Informe a data do pagamento');
  if (dataStr > todayISODate()) return showToast('❌ A data não pode ser futura');

  // PIX ⇒ comprovante obrigatório
  if (metodo === 'pix') {
    if (!file) return showToast('❌ Anexe o comprovante do PIX');
    const fileError = validateReceiptFile(file);
    if (fileError) return showToast('❌ ' + fileError);
  }

  await guarded(document.getElementById('btn-confirm-abater'), async () => {
    let receipt = null;

    try {
      if (metodo === 'pix') {
        showToast('⏳ Enviando comprovante...');
        receipt = await uploadReceipt(file, {
          uid: state.user.uid,
          bizId: state.currentBiz.id,
          saleId
        });
      }

      const ref = saleRefOf(saleId);

      // Lê a venda ATUAL dentro da transação (não depende do que está na tela).
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Venda não encontrada');

        const atual = { id: saleId, ...snap.data() };
        const saldo = getSaleBalance(atual);
        if (saldo <= 0) throw new Error('Esta venda já está quitada');
        if (valor > saldo + 0.001) {
          throw new Error(`O valor não pode passar o saldo restante (${brl(saldo)})`);
        }

        const novoValorPago = round2(Number(atual.valorPago || 0) + valor);
        const novoSaldo = Math.max(0, round2(Number(atual.total || 0) - novoValorPago));
        const quitou = novoSaldo <= 0;

        const entrada = {
          valor,
          data: dateInputToISO(dataStr),          // data em que o cliente pagou
          registradoEm: new Date().toISOString(), // quando foi lançado no sistema
          metodo,
          comprovantePath: receipt?.path || null,
          comprovanteTipo: receipt?.tipo || null
        };

        const update = {
          pagamentos: [...(Array.isArray(atual.pagamentos) ? atual.pagamentos : []), entrada],
          valorPago: novoValorPago,
          saldoRestante: novoSaldo,
          pago: quitou,
          fiadoStatus: quitou ? 'pago' : 'nao-pago',
          fiadoPaymentMethod: atual.fiadoPaymentMethod || metodo
        };
        if (quitou) update.dataPagamento = fmtDate(entrada.data);

        tx.update(ref, update);
      });

      closeBottomSheet('modal-abater-fiado');
      await loadProductsAndSales();
      showToast('✅ Pagamento registrado');
    } catch (error) {
      console.error('Erro ao registrar pagamento:', error);
      if (receipt) deleteReceipt(receipt.path);
      showToast('❌ ' + (error.message || 'Erro ao registrar pagamento'));
    }
  });
};

window.setHistFilter = function (filter, btn) {
  state.histFilter = filter;
  // Só reseta as abas do grupo de período, não as de tipo de venda
  document.querySelectorAll('.filter-tabs .filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderHistorico();
};

window.setSaleTypeFilter = function (filter, btn) {
  state.saleTypeFilter = filter;
  document.querySelectorAll('.historico-filters .filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderHistorico();
};

document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  setupNotifications();

  const addProductButton = document.getElementById('btn-adicionar-produto');
  const finalizeSaleButton = document.getElementById('btn-finalizar-venda');
  const photoUpload = document.getElementById('photo-upload');
  const productImageInput = document.getElementById('product-image');

  if (addProductButton) {
    addProductButton.addEventListener('click', () => window.adicionarProduto());
  }

  if (finalizeSaleButton) {
    finalizeSaleButton.addEventListener('click', () => window.finalizarVenda());
  }

  if (photoUpload) {
    photoUpload.addEventListener('click', () => {
      productImageInput.click();
    });
  }

  if (productImageInput) {
    productImageInput.addEventListener('change', handleImageSelect);
  }

  // Controle das opções de fiado
  setupPaymentMethodListeners();
});

function setupPaymentMethodListeners() {
  const paymentMethods = document.querySelectorAll('input[name="payment-method"]');
  const fiadoOptions = document.getElementById('fiado-options');
  const fiadoPaymentMethod = document.getElementById('fiado-payment-method');
  const fiadoStatusRadios = document.querySelectorAll('input[name="fiado-status"]');

  paymentMethods.forEach(radio => {
    radio.addEventListener('change', function () {
      if (this.value === 'fiado') {
        fiadoOptions.style.display = 'block';
        fiadoStatusRadios[0].checked = true; // "Não pago" por padrão
        fiadoPaymentMethod.style.display = 'none';
      } else {
        fiadoOptions.style.display = 'none';
        fiadoPaymentMethod.style.display = 'none';
      }
      updateSaleReceiptVisibility();
    });
  });

  fiadoStatusRadios.forEach(radio => {
    radio.addEventListener('change', function () {
      fiadoPaymentMethod.style.display = this.value === 'pago' ? 'block' : 'none';
      updateSaleReceiptVisibility();
    });
  });

  document.querySelectorAll('input[name="fiado-payment"]').forEach(radio => {
    radio.addEventListener('change', updateSaleReceiptVisibility);
  });
}

// ===== BOTTOM SHEET SYSTEM =====
window.openBottomSheet = function(id, html) {
  // Remove qualquer sheet existente com mesmo id
  const existing = document.getElementById(id);
  if (existing) existing.remove();

  const sheet = document.createElement('div');
  sheet.className = 'bs-overlay';
  sheet.id = id;
  sheet.innerHTML = `<div class="bs-sheet">${html}</div>`;

  // Fecha ao clicar no backdrop
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) closeBottomSheet(id);
  });

  document.body.appendChild(sheet);

  // Força reflow para animação funcionar
  requestAnimationFrame(() => {
    requestAnimationFrame(() => sheet.classList.add('bs-open'));
  });
};

window.closeBottomSheet = function(id) {
  const sheet = document.getElementById(id);
  if (!sheet) return;
  sheet.classList.remove('bs-open');
  sheet.addEventListener('transitionend', () => sheet.remove(), { once: true });
};

window.bsAdjustQty = function(inputId, delta) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const min = parseInt(input.min) || 1;
  const max = parseInt(input.max) || 9999;
  const current = parseInt(input.value) || 1;
  const next = Math.min(max, Math.max(min, current + delta));
  input.value = next;
};

// ===== SERVICE WORKER REGISTRATION =====
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registrado:', registration);

      // Verifica se já está instalado
      if (registration.active) {
        console.log('Service Worker ativo');
      }

      // Escuta mudanças de estado
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateNotification();
            }
          });
        }
      });

    } catch (error) {
      console.error('Erro ao registrar Service Worker:', error);
    }
  }
}

// ===== NOTIFICATIONS SETUP =====
let stockCheckScheduled = false;

const notificationsSupported = () => 'Notification' in window && 'serviceWorker' in navigator;

async function setupNotifications() {
  if (!notificationsSupported()) return;

  // Já tem permissão: agenda a checagem de estoque (antes só agendava logo após
  // o usuário aceitar, então depois de recarregar o app nunca mais verificava).
  if (Notification.permission === 'granted') {
    scheduleStockCheck();
  }
}

// Pede permissão só depois de uma ação de valor (1º produto / 1ª venda),
// e não na tela de login.
function maybeAskNotifications() {
  if (!notificationsSupported()) return;
  if (Notification.permission !== 'default') return;
  if (localStorage.getItem('notif-prompt-dismissed')) return;
  if (document.getElementById('notification-prompt')) return;
  showNotificationPrompt();
}

function showNotificationPrompt() {
  const prompt = document.createElement('div');
  prompt.id = 'notification-prompt';
  prompt.innerHTML = `
    <div class="notification-prompt">
      <div class="prompt-icon">🔔</div>
      <div class="prompt-text">
        <strong>Ativar notificações?</strong>
        <p>Receba alertas sobre produtos com estoque baixo</p>
      </div>
      <div class="prompt-buttons">
        <button class="btn-secondary" onclick="dismissNotificationPrompt()">Agora não</button>
        <button class="btn-primary" onclick="requestNotificationPermission()">Ativar</button>
      </div>
    </div>
  `;
  prompt.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 1000;
    max-width: 300px;
  `;
  document.body.appendChild(prompt);
}

window.hideNotificationPrompt = function () {
  document.getElementById('notification-prompt')?.remove();
};

window.dismissNotificationPrompt = function () {
  localStorage.setItem('notif-prompt-dismissed', '1');
  hideNotificationPrompt();
};

window.requestNotificationPermission = async function () {
  try {
    const permission = await Notification.requestPermission();

    if (permission === 'granted') {
      state.notificationsEnabled = true;
      scheduleStockCheck();
      checkLowStock();
      showToast('✅ Notificações ativadas!');
    } else {
      showToast('❌ Notificações desativadas');
    }
  } catch (error) {
    console.error('Erro ao solicitar permissão:', error);
  }

  hideNotificationPrompt();
};

// ===== STOCK MONITORING =====
function scheduleStockCheck() {
  if (stockCheckScheduled) return; // evita registrar o intervalo várias vezes
  stockCheckScheduled = true;

  // Verifica estoque a cada 5 minutos quando a aba está ativa
  setInterval(() => {
    if (document.visibilityState === 'visible') checkLowStock();
  }, 5 * 60 * 1000);

  // Também verifica quando volta para a aba
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkLowStock();
  });
}

async function checkLowStock() {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  if (!state.products.length) return;

  const lowStockProducts = state.products.filter(p => p.qtd <= 4 && p.qtd > 0);
  const outOfStockProducts = state.products.filter(p => p.qtd === 0);

  // Evita spam: só notifica uma vez por produto até o estoque mudar
  lowStockProducts.forEach(product => {
    const notificationId = `low-stock-${product.id}`;
    if (!localStorage.getItem(notificationId)) {
      showStockNotification(product, 'low');
      localStorage.setItem(notificationId, 'true');
    }
  });

  outOfStockProducts.forEach(product => {
    const notificationId = `out-stock-${product.id}`;
    if (!localStorage.getItem(notificationId)) {
      showStockNotification(product, 'out');
      localStorage.setItem(notificationId, 'true');
    }
  });
}

// Limpa as flags de notificação de um produto, para que ele possa
// notificar de novo caso o estoque volte a ficar baixo/esgotado no futuro
function clearStockNotificationFlags(productId) {
  localStorage.removeItem(`low-stock-${productId}`);
  localStorage.removeItem(`out-stock-${productId}`);
}

function showStockNotification(product, type) {
  const title = type === 'out' ? '🚨 Produto Esgotado!' : '⚠️ Estoque Baixo';
  const body = type === 'out'
    ? `${product.nome} está esgotado!`
    : `${product.nome} tem apenas ${product.qtd} unidade(s) em estoque`;

  const icon = product.imageUrl || './assets/logo-icon.png';

  navigator.serviceWorker.ready.then(registration => {
    registration.showNotification(title, {
      body,
      icon,
      badge: './assets/logo-icon.png',
      tag: `stock-${product.id}`,
      requireInteraction: true,
      data: { url: './produkti.html', productId: product.id },
      actions: [{ action: 'view', title: 'Ver Produto' }]
    });
  }).catch(() => {
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon });
    }
  });
}

// ===== UPDATE NOTIFICATION =====
function showUpdateNotification() {
  const updateToast = document.createElement('div');
  updateToast.className = 'update-toast';
  updateToast.innerHTML = `
    <div class="update-content">
      <span>🔄 Nova versão disponível!</span>
      <button onclick="location.reload()">Atualizar</button>
    </div>
  `;
  updateToast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: var(--gold);
    color: var(--brown);
    padding: 12px 16px;
    border-radius: 8px;
    box-shadow: var(--shadow);
    z-index: 1000;
    font-weight: 600;
  `;
  document.body.appendChild(updateToast);

  // Remove automaticamente após 10 segundos
  setTimeout(() => {
    if (updateToast.parentNode) {
      updateToast.remove();
    }
  }, 10000);
}

function handleImageSelect(event) {
  const file = event.target.files[0];
  if (file) {
    // Validar tipo de arquivo
    if (!file.type.startsWith('image/')) {
      showToast('❌ Selecione apenas arquivos de imagem');
      event.target.value = '';
      resetPhotoUpload();
      return;
    }

    // Validar tamanho (máximo 5MB)
    if (file.size > 5 * 1024 * 1024) {
      showToast('❌ Imagem muito grande (máx. 5MB)');
      event.target.value = '';
      resetPhotoUpload();
      return;
    }

    // Mostrar preview
    const reader = new FileReader();
    reader.onload = function (e) {
      const photoUpload = document.getElementById('photo-upload');
      photoUpload.style.backgroundImage = `url(${e.target.result})`;
      photoUpload.style.backgroundSize = 'cover';
      photoUpload.style.backgroundPosition = 'center';
      document.getElementById('photo-text').textContent = 'Foto selecionada';
      photoUpload.classList.add('has-image');
    };
    reader.readAsDataURL(file);
  }
}

function resetPhotoUpload() {
  const photoUpload = document.getElementById('photo-upload');
  photoUpload.style.backgroundImage = '';
  document.getElementById('photo-text').textContent = 'Adicionar foto';
  photoUpload.classList.remove('has-image');
}
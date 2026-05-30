// app.js

let uploadedImageUrl = "";

import {
  doc,
  deleteDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
  uploadProductImage,
  deleteProductImage
} from "./services/firestoreService.js";

// ===== STATE =====
let state = {
  businesses: [],
  currentBiz: null,
  products: [],
  sales: [],
  cart: [],
  histFilter: 'todas',
  saleTypeFilter: 'todas',
  notificationsEnabled: false
};

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
  if (user) {
    state.user = user;
    await loadBusinesses();
    showScreen('screen-business');
  } else {
    showScreen('screen-login');
  }
});

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
      <div class="business-info" onclick="enterBusiness('${b.id}')">
        <strong>${b.name}</strong>
        <span>Toque para entrar</span>
      </div>

      <button
        class="delete-business-btn"
        onclick="deleteBusiness('${b.id}')"
      >
        🗑️
      </button>
    </div>
  `).join('');
};

window.enterBusiness = function (id) {
  state.currentBiz = state.businesses.find(b => b.id == id);
  document.getElementById('topbar-biz-name').textContent = state.currentBiz.name;
  loadProductsAndSales();
  showScreen('screen-app');
};

async function loadProductsAndSales() {
  state.products = await getProducts(state.currentBiz.id, state.user.uid);
  state.sales = await getSales(state.currentBiz.id, state.user.uid);
  renderProducts();
  updateStats();
  renderSellPage();
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

window.deleteBusiness = async function (id) {

  const confirmDelete =
    confirm("Deseja deletar este negócio?");

  if (!confirmDelete) return;

  try {

    console.log(db);
    const bizRef = doc(
      db,
      "users",
      state.user.uid,
      "businesses",
      id
    );

    await deleteDoc(bizRef);

    state.businesses =
      state.businesses.filter(
        b => b.id !== id
      );

    renderBusinessList();

    showToast("🗑️ Negócio deletado");

  } catch (e) {

    console.error(e);

    showToast(
      "❌ Erro ao deletar negócio"
    );
  }
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

// ===== PRODUTOS (TEMP LOCAL AINDA) =====
window.renderProducts = function () {
  const el = document.getElementById('product-list-container');

  // popular filtros dinamicamente
  const marcas = Array.from(new Set(state.products.map(p => p.marca || 'N/A'))).sort();
  const categorias = Array.from(new Set(state.products.map(p => p.tipo || ''))).sort();
  const marcaSelect = document.getElementById('filter-marca');
  const categoriaSelect = document.getElementById('filter-categoria');
  if (marcaSelect) {
    marcaSelect.innerHTML = '<option value="">Todas as marcas</option>' + marcas.map(m => `<option value="${m}">${m}</option>`).join('');
  }
  if (categoriaSelect) {
    categoriaSelect.innerHTML = '<option value="">Todas as categorias</option>' + categorias.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  if (!state.products.length) {
    el.innerHTML = `<p class="no-products-msg">Nenhum produto</p>`;
    return;
  }

  // aplicar pesquisa e filtros
  const searchTerm = document.getElementById('search-produto') ? document.getElementById('search-produto').value.toLowerCase() : '';
  const filterMarca = document.getElementById('filter-marca') ? document.getElementById('filter-marca').value : '';
  const filterCat = document.getElementById('filter-categoria') ? document.getElementById('filter-categoria').value : '';
  const quase = document.getElementById('filter-quase') ? document.getElementById('filter-quase').checked : false;
  const esgotado = document.getElementById('filter-esgotado') ? document.getElementById('filter-esgotado').checked : false;

  const filtered = state.products.filter(p => {
    const nameMatch = p.nome && p.nome.toLowerCase().includes(searchTerm);
    const marcaMatch = p.marca && p.marca.toLowerCase().includes(searchTerm);
    const tipoMatch = p.tipo && p.tipo.toLowerCase().includes(searchTerm);

    if (searchTerm && !(nameMatch || marcaMatch || tipoMatch)) return false;
    if (filterMarca && p.marca !== filterMarca) return false;
    if (filterCat && p.tipo !== filterCat) return false;
    if (esgotado && p.qtd !== 0) return false;
    if (quase && !(p.qtd <= 4 && p.qtd > 0)) return false;
    return true;
  });

  el.innerHTML = filtered.map(p => `

      <div class="product-card">

        ${
          p.imageUrl
          ? `<img
              src="${p.imageUrl}"
              alt="${p.nome}"
              class="product-image"
            />`
          : `<div class="product-thumb">
              📦
            </div>`
        }

        <div class="product-info">

          <strong>${p.nome}</strong>

          <small>${p.marca || 'N/A'} • ${p.tipo || ''}</small>

          <small>
            Estoque: ${p.qtd}
          </small>

        </div>

        <div class="product-actions">

          <button
            class="edit-btn"
            onclick="editarProduto('${p.id}')"
          >
            ✏️
          </button>

          <button
            class="restock-btn"
            onclick="reporEstoque('${p.id}')"
            title="Reposição de estoque"
          >
            ➕
          </button>

          <button
            class="delete-btn"
            onclick="deletarProduto('${p.id}')"
            title="Deletar produto"
          >
            🗑️
          </button>

        </div>

      </div>

    `).join('');
};

window.deletarProduto = async function (id) {

  const confirmDelete =
    confirm("Deletar produto?");

  if (!confirmDelete) return;

  try {

    await deleteProduct(
      state.currentBiz.id,
      state.user.uid,
      id
    );

    state.products =
      state.products.filter(
        p => p.id !== id
      );

    renderProducts();

    showToast(
      "🗑️ Produto deletado"
    );

  } catch (e) {

    console.error(e);

    showToast(
      "❌ Erro ao deletar"
    );
  }
};

window.reporEstoque = function(id) {
  const produto = state.products.find(p => p.id === id);
  if (!produto) return showToast('Produto não encontrado');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.id = `modal-repor-${id}`;
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Reposição de estoque</h3>
        <button class="modal-close" onclick="document.getElementById('modal-repor-${id}').remove()">×</button>
      </div>
      <div class="modal-body">
        <p>Produto: <strong>${produto.nome}</strong></p>
        <p>Estoque atual: <strong>${produto.qtd} unidades</strong></p>
        <div class="field-group">
          <label>Quantidade a adicionar</label>
          <input type="number" id="repor-qtd-${id}" value="1" min="1" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="document.getElementById('modal-repor-${id}').remove()">Cancelar</button>
        <button class="btn-primary" onclick="confirmReporEstoque('${id}')">Adicionar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};

window.confirmReporEstoque = async function(id) {
  const input = document.getElementById(`repor-qtd-${id}`);
  const add = parseInt(input.value || 0);
  if (!add || add <= 0) return showToast('Quantidade inválida');

  try {
    const produto = state.products.find(p => p.id === id);
    const novaQtd = (produto.qtd || 0) + add;
    await updateProduct(state.currentBiz.id, state.user.uid, id, { qtd: novaQtd });
    // Fecha pelo id único em vez de querySelector genérico
    document.getElementById(`modal-repor-${id}`).remove();
    await loadProductsAndSales();
    showToast('✅ Estoque atualizado');
  } catch (e) {
    console.error(e);
    showToast('❌ Erro ao atualizar estoque');
  }
};

window.editarProduto = function (id) {
  const produto = state.products.find(p => p.id === id);
  if (!produto) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.id = `modal-editar-${id}`;
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Editar Produto</h3>
        <button class="modal-close" onclick="document.getElementById('modal-editar-${id}').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="field-group">
          <label for="edit-nome">Nome do produto</label>
          <input type="text" id="edit-nome" value="${produto.nome}" />
        </div>
        <div class="field-group">
          <label for="edit-qtd">Quantidade em estoque</label>
          <input type="number" id="edit-qtd" value="${produto.qtd}" min="0" />
        </div>
        <div class="field-group">
          <label for="edit-custo">Preço de custo (R$)</label>
          <input type="number" id="edit-custo" value="${produto.custo}" min="0" step="0.01" />
        </div>
        <div class="field-group">
          <label for="edit-marca">Marca</label>
          <input type="text" id="edit-marca" value="${produto.marca || ''}" />
        </div>
        <div class="field-group">
          <label for="edit-tipo">Categoria</label>
          <select id="edit-tipo">
            <option value="">Selecione o tipo</option>
            <option ${produto.tipo === 'Cosmético' ? 'selected' : ''}>Cosmético</option>
            <option ${produto.tipo === 'Alimento' ? 'selected' : ''}>Alimento</option>
            <option ${produto.tipo === 'Eletrônico' ? 'selected' : ''}>Eletrônico</option>
            <option ${produto.tipo === 'Vestuário' ? 'selected' : ''}>Vestuário</option>
            <option ${produto.tipo === 'Outro' ? 'selected' : ''}>Outro</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="document.getElementById('modal-editar-${id}').remove()">Cancelar</button>
        <button class="btn-primary" onclick="salvarEdicaoProduto('${id}')">Salvar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};

window.salvarEdicaoProduto = async function(id) {
  const novoNome = document.getElementById('edit-nome').value.trim();
  const novaQtd = parseInt(document.getElementById('edit-qtd').value);
  const novoCusto = parseFloat(document.getElementById('edit-custo').value);
  const novoMarca = document.getElementById('edit-marca').value.trim();
  const novoTipo = document.getElementById('edit-tipo').value.trim();

  if (!novoNome || novaQtd < 0 || isNaN(novoCusto) || novoCusto < 0) {
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

    // Fecha pelo id único
    document.getElementById(`modal-editar-${id}`).remove();

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

  // Total de produtos no estoque (não filtrado por mês)
  document.getElementById('stat-produtos').textContent = state.products.length;

  const salesThisMonth = state.sales.filter(s => {
    const d = (s.createdAt && typeof s.createdAt.toDate === 'function') ? s.createdAt.toDate() : (s.createdAt ? new Date(s.createdAt) : (s.data ? new Date(s.data) : null));
    if (!d) return false;
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  const totalVendas = salesThisMonth.reduce((sum, sale) => sum + (sale.total || 0), 0);
  document.getElementById('stat-vendas').textContent = 'R$ ' + totalVendas.toFixed(2).replace('.', ',');

  document.getElementById('stat-transacoes').textContent = salesThisMonth.length;

  // Lucro bruto do mês
  const lucroTotal = salesThisMonth.reduce((acc, sale) => {
    let saleLucro = 0;
    (sale.itens || []).forEach(it => {
      const prod = state.products.find(p => p.id === it.produtoId);
      const custo = prod ? parseFloat(prod.custo || 0) : 0;
      const precoVenda = parseFloat(it.preco || 0);
      const qtd = parseInt(it.quantidade || 0);
      saleLucro += (precoVenda - custo) * qtd;
    });
    return acc + saleLucro;
  }, 0);

  document.getElementById('stat-lucro').textContent = 'R$ ' + lucroTotal.toFixed(2).replace('.', ',');

  // Dízimo mensal (10% do lucro líquido do mês)
  const dizimo = lucroTotal * 0.1;
  const dizimoEl = document.getElementById('stat-dizimo');
  if (dizimoEl) {
    dizimoEl.textContent = 'R$ ' + dizimo.toFixed(2).replace('.', ',');
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
    showToast("Erro no login com Google");
  }
};

// ===== PRODUTOS: ADICIONAR =====
window.adicionarProduto = async function () {
  const nome = document.getElementById('add-nome').value.trim();
  const custo = parseFloat(document.getElementById('add-custo').value);
  const qtd = parseInt(document.getElementById('add-qtd').value);
  const tipo = document.getElementById('add-tipo').value.trim();
  const marca = document.getElementById('add-marca').value.trim();
  const imageFile = document.getElementById('product-image').files[0];

  if (!nome || isNaN(custo) || isNaN(qtd) || !tipo) {
    showToast('❌ Preencha todos os campos obrigatórios');
    return;
  }

  try {
    // ✅ Faz upload real da imagem antes de salvar o produto
    // uploadProductImage(file) — recebe só o arquivo, sem businessId/userId
    if (imageFile) {
      showToast('⏳ Enviando imagem...');
      uploadedImageUrl = await uploadProductImage(imageFile);
    }

    const product = {
      nome,
      custo,
      qtd,
      tipo,
      marca: marca || 'N/A',
      imageUrl: uploadedImageUrl
    };

    await addProduct(
      state.currentBiz.id,
      state.user.uid,
      product
    );

    uploadedImageUrl = "";
    resetPhotoUpload();

    // Limpar formulário
    document.getElementById('add-nome').value = '';
    document.getElementById('add-custo').value = '';
    document.getElementById('add-qtd').value = '';
    document.getElementById('add-tipo').value = '';
    document.getElementById('add-marca').value = '';
    document.getElementById('product-image').value = '';

    // Recarregar produtos
    await loadProductsAndSales();

    navTo('produtos');
    showToast('✅ Produto adicionado com sucesso!');
  } catch (e) {
    showToast('❌ Erro ao adicionar: ' + e.message);
  }
};

// ===== VENDER: CARRINHO =====
window.addToCart = function () {
  const selectEl = document.getElementById('sell-product-select');
  const productId = selectEl.value;

  if (!productId) return;

  const product = state.products.find(p => p.id === productId);
  if (!product) return showToast('Produto não encontrado');
  if (product.qtd <= 0) return showToast('❌ Produto fora de estoque');

  // Modal para quantidade e preço de venda (substitui os prompt() nativos)
  const modalId = `modal-add-cart-${productId}`;
  // Evita abrir duplicado
  if (document.getElementById(modalId)) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.id = modalId;
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Adicionar ao carrinho</h3>
        <button class="modal-close" onclick="document.getElementById('${modalId}').remove(); document.getElementById('sell-product-select').value = '';">×</button>
      </div>
      <div class="modal-body">
        <p style="margin-bottom:12px">Produto: <strong>${product.nome}</strong></p>
        <p style="margin-bottom:16px; font-size:0.85rem; color:var(--gray)">Estoque disponível: ${product.qtd} unidades</p>
        <div class="field-group">
          <label>Quantidade</label>
          <input type="number" id="cart-qty-${productId}" value="1" min="1" max="${product.qtd}" />
        </div>
        <div class="field-group">
          <label>Preço de venda por unidade (R$)</label>
          <input type="number" id="cart-price-${productId}" value="" min="0.01" step="0.01" placeholder="0,00" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="document.getElementById('${modalId}').remove(); document.getElementById('sell-product-select').value = '';">Cancelar</button>
        <button class="btn-primary" onclick="confirmAddToCart('${productId}', '${modalId}')">Adicionar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Foca no campo de preço automaticamente
  setTimeout(() => document.getElementById(`cart-price-${productId}`)?.focus(), 100);
};

window.confirmAddToCart = function(productId, modalId) {
  const product = state.products.find(p => p.id === productId);
  if (!product) return showToast('Produto não encontrado');

  const qty = parseInt(document.getElementById(`cart-qty-${productId}`).value || '0', 10);
  const price = parseFloat(document.getElementById(`cart-price-${productId}`).value.replace(',', '.') || '0');

  if (!qty || qty <= 0) return showToast('❌ Quantidade inválida');
  if (qty > product.qtd) return showToast('❌ Estoque insuficiente');
  if (isNaN(price) || price <= 0) return showToast('❌ Preço inválido');

  const cartItem = state.cart.find(c => c.id === productId);
  if (cartItem) {
    if (cartItem.quantidade + qty > product.qtd) return showToast('❌ Estoque insuficiente');
    cartItem.quantidade += qty;
    cartItem.preco = price;
  } else {
    state.cart.push({ id: product.id, nome: product.nome, preco: price, quantidade: qty });
  }

  document.getElementById(modalId).remove();
  document.getElementById('sell-product-select').value = '';
  renderCart();
  showToast('✅ Produto adicionado ao carrinho');
};

// ===== VENDER: RENDERIZAR PÁGINA =====
window.renderSellPage = function () {
  const selectEl = document.getElementById('sell-product-select');

  selectEl.innerHTML = '<option value="">Selecione um produto</option>';

    state.products.forEach(p => {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = `${p.nome} (${p.qtd} em estoque) - ${p.marca || ''}`;
    selectEl.appendChild(option);
  });

  renderCart();
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
    const total = item.preco * item.quantidade;
    subtotal += total;
    return `
      <div class="cart-item">
        <div class="cart-item-info">
          <strong>${item.nome}</strong>
          <span class="cart-item-price">R$ ${item.preco.toFixed(2)} x${item.quantidade}</span>
        </div>
        <div class="cart-item-controls">
          <button class="cart-btn" onclick="removeFromCart('${item.id}')">-</button>
          <span>${item.quantidade}</span>
          <button class="cart-btn" onclick="addFromCart('${item.id}')">+</button>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('summary-sub').textContent = 'R$ ' + subtotal.toFixed(2).replace('.', ',');
  document.getElementById('summary-total').textContent = 'R$ ' + subtotal.toFixed(2).replace('.', ',');
  summaryWrap.style.display = 'block';
};

window.removeFromCart = function (productId) {
  state.cart = state.cart.filter(c => c.id !== productId);
  renderCart();
};

window.addFromCart = function (productId) {
  const cartItem = state.cart.find(c => c.id === productId);
  const product = state.products.find(p => p.id === productId);

  if (cartItem.quantidade < product.qtd) {
    cartItem.quantidade++;
    renderCart();
  } else {
    showToast('❌ Quantidade indisponível');
  }
};

// ===== VENDER: FINALIZAR VENDA =====
window.finalizarVenda = async function () {
  const clientName = document.getElementById('client-name').value.trim();
  const clientPhone = document.getElementById('client-phone').value.trim();
  const firstBuy = document.getElementById('first-buy').checked;

  // Método de pagamento
  const paymentMethod = document.querySelector('input[name="payment-method"]:checked').value;
  let fiadoStatus = null;
  let fiadoPaymentMethod = null;

  if (paymentMethod === 'fiado') {
    fiadoStatus = document.querySelector('input[name="fiado-status"]:checked').value;
    if (fiadoStatus === 'pago') {
      fiadoPaymentMethod = document.querySelector('input[name="fiado-payment"]:checked').value;
    }
  }

  if (!clientName) {
    showToast('❌ Digite o nome do cliente');
    return;
  }

  if (!paymentMethod) {
    showToast('❌ Selecione um método de pagamento');
    return;
  }

  if (state.cart.length === 0) {
    showToast('❌ Adicione produtos ao carrinho');
    return;
  }

  try {
    let total = 0;
    let totalLucro = 0;

    // verificar estoque insuficiente antes
    for (const cartItem of state.cart) {
      const prod = state.products.find(p => p.id === cartItem.id);
      if (!prod) return showToast('Produto não encontrado: ' + cartItem.nome);
      if (cartItem.quantidade > prod.qtd) return showToast(`Estoque insuficiente para ${cartItem.nome}`);
    }

    const items = state.cart.map(item => {
      const itemTotal = item.preco * item.quantidade;
      total += itemTotal;
      const prod = state.products.find(p => p.id === item.id);
      const custo = prod ? parseFloat(prod.custo || 0) : 0;
      const lucroItem = (parseFloat(item.preco || 0) - custo) * item.quantidade;
      totalLucro += lucroItem;
      return {
        produtoId: item.id,
        nome: item.nome,
        preco: item.preco,
        quantidade: item.quantidade,
        subtotal: itemTotal,
        lucro: lucroItem
      };
    });

    const sale = {
      cliente: clientName,
      telefone: clientPhone || 'N/A',
      primeiraCompra: firstBuy,
      itens: items,
      total: total,
      lucro: totalLucro,
      data: new Date().toLocaleString('pt-BR'),
      metodoPagamento: paymentMethod,
      fiadoStatus: fiadoStatus,
      fiadoPaymentMethod: fiadoPaymentMethod,
      pago: paymentMethod !== 'fiado' || fiadoStatus === 'pago'
    };

    // Salvar no Firestore
    await addSale(state.currentBiz.id, state.user.uid, sale);

    // Atualizar quantidade de produtos apenas se não for fiado ou se for fiado pago
    if (paymentMethod !== 'fiado' || fiadoStatus === 'pago') {
      for (const item of items) {
        const product = state.products.find(p => p.id === item.produtoId);
        const novaQtd = product.qtd - item.quantidade;

        await updateProduct(
          state.currentBiz.id,
          state.user.uid,
          item.produtoId,
          { qtd: novaQtd }
        );
      }
    }

    // Limpar formulário
    state.cart = [];
    document.getElementById('client-name').value = '';
    document.getElementById('client-phone').value = '';
    document.getElementById('first-buy').checked = false;
    document.querySelector('input[name="payment-method"][value="especie"]').checked = true;
    document.getElementById('fiado-options').style.display = 'none';
    document.getElementById('fiado-payment-method').style.display = 'none';

    renderCart();
    await loadProductsAndSales();

    showToast('✅ Venda registrada com sucesso!');
    navTo('produtos');

  } catch (e) {
    console.error(e);
    showToast('❌ Erro ao finalizar venda: ' + e.message);
  }
};

// ===== HISTÓRICO =====
window.renderHistorico = function () {
  const historicoList = document.getElementById('historico-list');
  const searchTerm = document.getElementById('search-historico').value.toLowerCase();

  let filtered = state.sales.filter(s =>
    s.cliente.toLowerCase().includes(searchTerm)
  );

  // Aplicar filtro de data
  if (state.histFilter !== 'todas') {
    const now = new Date();
    filtered = filtered.filter(s => {
      const saleDate = new Date(s.data);

      switch (state.histFilter) {
        case 'hoje':
          return saleDate.toDateString() === now.toDateString();
        case 'semana':
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          return saleDate >= weekAgo;
        case 'mes':
          return saleDate.getMonth() === now.getMonth() &&
            saleDate.getFullYear() === now.getFullYear();
        case 'ano':
          return saleDate.getFullYear() === now.getFullYear();
        default:
          return true;
      }
    });
  }

  // Aplicar filtro de tipo de venda
  if (state.saleTypeFilter !== 'todas') {
    filtered = filtered.filter(s => {
      switch (state.saleTypeFilter) {
        case 'fiado':
          return s.metodoPagamento === 'fiado' && s.fiadoStatus === 'nao-pago';
        case 'pagas':
          return s.pago === true;
        default:
          return true;
      }
    });
  }

  if (filtered.length === 0) {
    historicoList.innerHTML = '<p class="no-products-msg">Nenhuma venda encontrada</p>';
    return;
  }

  historicoList.innerHTML = filtered.map(sale => `
    <div class="historico-item ${sale.metodoPagamento === 'fiado' && sale.fiadoStatus === 'nao-pago' ? 'fiado' : ''}">
      <div class="historico-header">
        <strong>${sale.cliente}</strong>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${sale.metodoPagamento === 'fiado' && sale.fiadoStatus === 'nao-pago' ? '<span class="fiado-badge">Fiado</span>' : ''}
          ${sale.pago && sale.metodoPagamento !== 'fiado' ? '<span class="pago-badge">Pago</span>' : ''}
          ${sale.pago && sale.metodoPagamento === 'fiado' ? '<span class="pago-badge">Pago</span>' : ''}
          <span class="historico-total">
            R$ ${Number(sale.total || 0).toFixed(2).replace('.', ',')}
          </span>
        </div>
      </div>
      <div class="historico-meta">
        <span>${sale.data}</span>
        <span>${sale.itens.length} item(ns)</span>
        <span>Método: ${getPaymentMethodLabel(sale)}</span>
        ${sale.primeiraCompra ? '<span class="badge-novo">Primeira compra</span>' : ''}
      </div>
      <div class="historico-itens">
        ${sale.itens.map(item => `
          <span>${item.nome} (x${item.quantidade})</span>
        `).join('')}
      </div>
      <div class="historico-actions">
        <strong style="margin-right:8px">Lucro: R$ ${(sale.lucro||0).toFixed(2).replace('.',',')}</strong>
        ${sale.telefone && sale.telefone !== 'N/A' ? `<button class="btn-link" onclick="showClientPhone('${sale.telefone}')">📞 Ver telefone</button>` : ''}
        ${sale.metodoPagamento === 'fiado' && sale.fiadoStatus === 'nao-pago' ? `<button class="btn-link" onclick="editarVendaFiada('${sale.id}')">✏️ Marcar como pago</button>` : ''}
        <button class="btn-link" onclick="viewSaleDetails('${sale.id}')">🔎 Ver detalhes</button>
      </div>
    </div>
  `).join('');
};

window.viewSaleDetails = function(saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return showToast('Venda não encontrada');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Detalhes da Venda</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      </div>
      <div class="modal-body">
        <p><strong>Data:</strong> ${sale.data}</p>
        <p><strong>Total:</strong> R$ ${ (sale.total||0).toFixed(2).replace('.',',') }</p>
        <p><strong>Lucro:</strong> R$ ${ (sale.lucro||0).toFixed(2).replace('.',',') }</p>
        <p><strong>Cliente:</strong> ${sale.cliente}</p>
        <p><strong>Telefone:</strong> ${sale.telefone || 'N/A'}</p>
        <p><strong>Método:</strong> ${sale.metodoPagamento}</p>
        <hr />
        <div>
          ${(sale.itens || []).map(it => `
            <div style="display:flex;justify-content:space-between;margin-bottom:6px">
              <div>
                <strong>${it.nome}</strong>
                <div style="font-size:0.9rem;color:var(--gray)">Qtd: ${it.quantidade} x R$ ${parseFloat(it.preco).toFixed(2).replace('.',',')}</div>
              </div>
              <div style="text-align:right">
                <div>Subtotal: R$ ${(it.subtotal||0).toFixed(2).replace('.',',')}</div>
                <div>Lucro: R$ ${(it.lucro||0).toFixed(2).replace('.',',')}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Fechar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};

function getPaymentMethodLabel(sale) {
  if (sale.metodoPagamento === 'fiado') {
    if (sale.fiadoStatus === 'pago') {
      return `Fiado (${sale.fiadoPaymentMethod})`;
    }
    return 'Fiado (Não pago)';
  }
  return sale.metodoPagamento;
}

window.showClientPhone = function(phone) {
  console.log('showClientPhone chamado com phone:', phone);
  // Modal simples para mostrar telefone
  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Telefone do Cliente</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="phone-display">
          <strong>📞 ${phone}</strong>
        </div>
        <p style="margin-top: 16px; color: var(--brown-light); font-size: 0.9rem;">
          Este telefone foi fornecido pelo cliente no momento da venda.
        </p>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};

window.editarVendaFiada = function(saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.id = 'modal-marcar-pago';
  modal.innerHTML = `
    <div class="modal-content modal-edit-venda">
      <div class="modal-header">
        <h3>Marcar venda como paga</h3>
        <button class="modal-close" onclick="document.getElementById('modal-marcar-pago').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="edit-venda-form">
          <div class="field-group">
            <label>Cliente: <strong>${sale.cliente}</strong></label>
          </div>
          <div class="field-group">
            <label>Total: <strong>R$ ${sale.total.toFixed(2).replace('.', ',')}</strong></label>
          </div>
          <div class="field-group">
            <label for="edit-payment-method">Como foi pago?</label>
            <select id="edit-payment-method">
              <option value="especie">💵 Espécie</option>
              <option value="cartao">💳 Cartão</option>
              <option value="pix">📱 PIX</option>
            </select>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="document.getElementById('modal-marcar-pago').remove()">Cancelar</button>
        <button class="btn-primary" onclick="marcarVendaComoPaga('${saleId}')">Marcar como Paga</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};

window.marcarVendaComoPaga = async function(saleId) {
  const paymentMethod = document.getElementById('edit-payment-method').value;

  try {
    // ✅ Path correto seguindo o padrão do app (users/{uid}/businesses/{bizId}/sales/{saleId})
    const saleRef = doc(db, 'users', state.user.uid, 'businesses', state.currentBiz.id, 'sales', saleId);
    await updateDoc(saleRef, {
      pago: true,
      fiadoStatus: 'pago',
      fiadoPaymentMethod: paymentMethod,
      dataPagamento: new Date().toLocaleString('pt-BR')
    });

    // Atualizar quantidade dos produtos (agora que foi pago)
    const sale = state.sales.find(s => s.id === saleId);
    for (const item of sale.itens) {
      const product = state.products.find(p => p.id === item.produtoId);
      if (!product) continue;
      const novaQtd = product.qtd - item.quantidade;

      await updateProduct(
        state.currentBiz.id,
        state.user.uid,
        item.produtoId,
        { qtd: novaQtd }
      );
    }

    // Fechar modal pelo ID único em vez de querySelector genérico
    document.getElementById('modal-marcar-pago').remove();
    await loadProductsAndSales();
    showToast('✅ Venda marcada como paga!');

  } catch (error) {
    console.error('Erro ao marcar venda como paga:', error);
    showToast('❌ Erro ao atualizar venda');
  }
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
    radio.addEventListener('change', function() {
      if (this.value === 'fiado') {
        fiadoOptions.style.display = 'block';
        fiadoStatusRadios[0].checked = true; // "Não pago" por padrão
        fiadoPaymentMethod.style.display = 'none';
      } else {
        fiadoOptions.style.display = 'none';
        fiadoPaymentMethod.style.display = 'none';
      }
    });
  });

  fiadoStatusRadios.forEach(radio => {
    radio.addEventListener('change', function() {
      if (this.value === 'pago') {
        fiadoPaymentMethod.style.display = 'block';
      } else {
        fiadoPaymentMethod.style.display = 'none';
      }
    });
  });
}

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
async function setupNotifications() {
  if ('Notification' in window && 'serviceWorker' in navigator) {
    // Verifica se já tem permissão
    if (Notification.permission === 'granted') {
      state.notificationsEnabled = true;
      console.log('Notificações já permitidas');
      return;
    }

    // Se ainda não pediu permissão, pede
    if (Notification.permission === 'default') {
      // Mostra botão para ativar notificações
      showNotificationPrompt();
    }
  }
}

// ===== NOTIFICATION PROMPT =====
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
        <button class="btn-secondary" onclick="hideNotificationPrompt()">Agora não</button>
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

window.hideNotificationPrompt = function() {
  const prompt = document.getElementById('notification-prompt');
  if (prompt) prompt.remove();
};

window.requestNotificationPermission = async function() {
  try {
    const permission = await Notification.requestPermission();

    if (permission === 'granted') {
      state.notificationsEnabled = true;
      console.log('Permissão de notificações concedida');

      // Registra para receber notificações push
      await subscribeToPushNotifications();

      showToast('✅ Notificações ativadas!');
    } else {
      console.log('Permissão de notificações negada');
      showToast('❌ Notificações desativadas');
    }
  } catch (error) {
    console.error('Erro ao solicitar permissão:', error);
  }

  hideNotificationPrompt();
};

// ===== PUSH NOTIFICATIONS SUBSCRIPTION =====
async function subscribeToPushNotifications() {
  try {
    const registration = await navigator.serviceWorker.ready;

    // Para notificações push reais, você precisaria de um servidor
    // Por enquanto, apenas simulamos notificações locais
    console.log('Push subscription ready');

    // Agenda verificação periódica de estoque
    scheduleStockCheck();

  } catch (error) {
    console.error('Erro no push subscription:', error);
  }
}

// ===== STOCK MONITORING =====
function scheduleStockCheck() {
  // Verifica estoque a cada 5 minutos quando a aba está ativa
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      checkLowStock();
    }
  }, 5 * 60 * 1000); // 5 minutos

  // Também verifica quando volta para a aba
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkLowStock();
    }
  });
}

async function checkLowStock() {
  if (!state.notificationsEnabled || !state.products.length) return;

  const lowStockProducts = state.products.filter(p =>
    p.qtd <= 4 && p.qtd > 0 // Menos de 4 unidades
  );

  const outOfStockProducts = state.products.filter(p => p.qtd === 0);

  // Notificações para produtos com pouco estoque
  lowStockProducts.forEach(product => {
    const notificationId = `low-stock-${product.id}`;

    // Evita spam - só notifica uma vez por produto até ser visualizado
    if (!localStorage.getItem(notificationId)) {
      showStockNotification(product, 'low');
      localStorage.setItem(notificationId, 'true');
    }
  });

  // Notificações para produtos esgotados
  outOfStockProducts.forEach(product => {
    const notificationId = `out-stock-${product.id}`;

    if (!localStorage.getItem(notificationId)) {
      showStockNotification(product, 'out');
      localStorage.setItem(notificationId, 'true');
    }
  });
}

function showStockNotification(product, type) {
  const title = type === 'out' ? '🚨 Produto Esgotado!' : '⚠️ Estoque Baixo';
  const body = type === 'out'
    ? `${product.nome} está esgotado!`
    : `${product.nome} tem apenas ${product.qtd} unidade(s) em estoque`;

  // Tenta usar Service Worker para notificação persistente
  if ('serviceWorker' in navigator && 'Notification' in window) {
    navigator.serviceWorker.ready.then(registration => {
      registration.showNotification(title, {
        body: body,
        icon: product.imageUrl || '/icon-192.png',
        badge: '/icon-192.png',
        tag: `stock-${product.id}`,
        requireInteraction: true,
        data: {
          url: '/#produtos',
          productId: product.id
        },
        actions: [
          {
            action: 'view',
            title: 'Ver Produto'
          }
        ]
      });
    });
  } else {
    // Fallback para notificação do browser
    if (Notification.permission === 'granted') {
      new Notification(title, {
        body: body,
        icon: product.imageUrl || '/icon-192.png'
      });
    }
  }
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
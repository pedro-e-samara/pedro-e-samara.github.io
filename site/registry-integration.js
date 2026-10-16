/* Integração do HTML do Stitch com Code.gs v3. Mantém os componentes e o Pix existentes. */
(() => {
  'use strict';
  const state = { ready: false, busy: false, syncing: false, mine: [], drafts: new Set(), checkout: [], bridge: null, recovery: false, canonicalPhone: false, readableRecovery: false, personalDelivery: false, revision: 0 };
  const ui = window.RegistryUI;
  const el = id => document.getElementById(id);
  const money = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const active = r => r.status === 'reservada';
  const delivery = r => r.formaPagamento === 'Entrega pessoal' && r.entrega === 'Confirmada';
  const unpaid = r => active(r) && r.pagamento !== 'Pago' && !delivery(r);
  const old = { init: app.init.bind(app), go: app.goToPage.bind(app) };

  class RegistryBridge {
    constructor(url) {
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) throw new Error('Configure a URL /exec do Apps Script em registry-config.js.');
      if (location.protocol === 'file:') throw new Error('Abra o site por http://localhost:8080 ou GitHub Pages para conectar à planilha.');
      this.channel = crypto.randomUUID(); this.pending = new Map(); this.peer = null;
      this.frame = document.createElement('iframe'); this.frame.hidden = true; this.frame.title = 'Conexão com a lista';
      this.ready = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Não foi possível conectar. Verifique /exec, acesso do Web App e SITE_ORIGINS.')), 25000);
        this.listener = event => {
          if (!/^https:\/\/[a-z0-9-]*script\.googleusercontent\.com$/.test(event.origin) || !event.data || event.data.channel !== this.channel) return;
          if (event.data.type === 'ready' && !this.peer) {
            this.peer = event.source; this.origin = event.origin; clearTimeout(timeout); resolve(); return;
          }
          if (event.source !== this.peer || event.origin !== this.origin) return;
          const wait = this.pending.get(event.data.id);
          if (event.data.type === 'response' && wait) {
            this.pending.delete(event.data.id); clearTimeout(wait.timer);
            const error = new Error(event.data.result?.error || 'Falha ao salvar.'); error.code = event.data.result?.code;
            event.data.result?.ok ? wait.resolve(event.data.result.data) : wait.reject(error);
          }
        };
        window.addEventListener('message', this.listener);
      });
      this.frame.src = url + '?action=bridge&origin=' + encodeURIComponent(location.origin) + '&channel=' + encodeURIComponent(this.channel);
      document.body.append(this.frame);
    }
    async request(action, data = {}) {
      await this.ready;
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('A resposta demorou. Atualize a lista para verificar se a operação foi salva.')); }, 45000);
        this.pending.set(id, { resolve, reject, timer });
        this.peer.postMessage({ type: 'request', channel: this.channel, id, request: { ...data, action } }, this.origin);
      });
    }
  }

  function credentials() {
    return { convidadoId: app.guestData?.id, token: app.guestData?.token };
  }
  function saveGuest(guest) {
    app.guestData = { id: guest.id, token: guest.token, name: guest.nome, phone: guest.telefone, recoveryCode: guest.recoveryCode || null };
    ui.storage.write('ps_guest_user', app.guestData); app.updateGuestBadge();
  }
  function saveDrafts() { ui.storage.write('ps_registry_drafts', { guestId: app.guestData?.id, ids: [...state.drafts] }); }
  function clearIdentity() {
    app.guestData = null; state.mine = []; state.drafts.clear(); state.checkout = [];
    ui.storage.remove('ps_guest_user'); ui.storage.remove('ps_registry_drafts'); app.updateGuestBadge();
  }
  function message(text, error = false) {
    const box = el('registry-message'); if (!box) return;
    box.textContent = text;
    box.dataset.page = app.currentPage; box.hidden = false;
    box.className = 'mb-5 rounded-xl border p-3 text-sm ' + (error ? 'border-red-200 bg-red-50 text-red-800' : 'border-sand bg-ivory-50 text-charcoal-700');
    box.classList.toggle('registry-failure', error);
  }
  function setCatalog(items) {
    const icons = new Map(GIFTS_DATABASE.map(g => [g.id, g.icon]));
    GIFTS_DATABASE.splice(0, GIFTS_DATABASE.length, ...items.map(g => ({ ...g, icon: icons.get(g.id) || 'gift' })));
    app.unavailableGifts = items.filter(g => !g.disponivel).map(g => g.id);
  }
  function accept(result) {
    if (result.presentes) setCatalog(result.presentes);
    if (result.reservas) state.mine = result.reservas;
    render();
  }
  async function sync(initial = false) {
    if (!state.bridge || state.busy || state.syncing) return;
    state.syncing = true; const revision = state.revision;
    if (initial) document.body.dataset.registryState = 'loading';
    if (initial) ui.loading(true, 'Consultando nossa lista…', app.guestData?.token ? 'Estamos recuperando sua identificação e seus presentes.' : 'Estamos verificando quais presentes estão disponíveis.');
    try {
      const [items, health, mine] = await Promise.all([
        state.bridge.request('list'),
        initial ? state.bridge.request('health') : Promise.resolve(null),
        app.guestData?.token ? state.bridge.request('mine', credentials()).catch(err => {
          if (/identifica/i.test(err.message)) { clearIdentity(); return []; } throw err;
        }) : Promise.resolve([])
      ]);
      if (revision !== state.revision) return;
      if (health) { state.recovery = health.features?.includes('recovery-code') || false; state.canonicalPhone = health.features?.includes('canonical-phone') || false; state.readableRecovery = health.features?.includes('readable-recovery') || false; state.personalDelivery = health.features?.includes('personal-delivery') || false; }
      state.mine = mine;
      for (const id of state.drafts) if (!items.some(g => g.id === id && g.disponivel)) state.drafts.delete(id);
      saveDrafts();
      setCatalog(items); state.ready = true; document.body.dataset.registryState = 'ready';
      if (initial && el('registry-message')) { el('registry-message').textContent = ''; el('registry-message').hidden = true; }
      render();
    } catch (err) {
      document.body.dataset.registryState = 'error';
      message(err.message, true);
      const retry = document.createElement('button'); retry.className = 'ml-3 underline font-medium'; retry.textContent = 'Tentar consultar novamente'; retry.onclick = () => sync(true); el('registry-message').append(retry);
    }
    finally { state.syncing = false; if (initial) ui.loading(false); }
  }
  async function operation(title, fn) {
    if (state.busy) return;
    state.busy = true; state.revision++; render(); ui.loading(true, title);
    try { await fn(); return true; }
    catch (err) {
      message(err.message, true);
      if (app.currentPage === 'identificacao') {
        const target = el('recovery-form').hidden ? el('form-error') : el('recovery-error');
        target.hidden = false; target.classList.remove('hidden'); target.textContent = err.message;
      }
      return false;
    }
    finally { state.busy = false; saveDrafts(); render(); ui.loading(false); }
  }
  function basket(ids = state.checkout.length ? state.checkout : [...state.drafts]) {
    return ids.map(id => {
      const g = GIFTS_DATABASE.find(x => x.id === id); if (!g) return null;
      const r = state.mine.find(x => x.presenteId === id && unpaid(x));
      return r ? { ...g, pix: r.valorPix, card: r.valorCartao } : g;
    }).filter(Boolean);
  }
  function aggregate() {
    const gifts = basket();
    if (!gifts.length) { app.selectedGift = null; return; }
    app.selectedGift = gifts.length === 1 ? gifts[0] : {
      id: gifts.map(g => g.id).join(', '), name: gifts.map(g => g.name).join(' + '),
      cat: gifts.length + ' presentes', pix: gifts.reduce((n, g) => n + g.pix, 0), card: gifts.reduce((n, g) => n + g.card, 0)
    };
    const total = app.selectedGift;
    const fields = {
      'pay-item-title': total.name, 'pay-item-code': total.id,
      'pay-pix-val': money(total.pix), 'pay-card-val': money(total.card),
      'pix-det-item': total.name, 'pix-det-code': total.id, 'pix-det-val': money(total.pix),
      'card-guest-name': app.guestData?.name || 'Convidado', 'card-item-title': total.name,
      'card-item-code': total.id, 'card-item-price': money(total.card)
    };
    Object.entries(fields).forEach(([id, value]) => { if (el(id)) el(id).textContent = value; });
    // Para vários presentes, o txid não pode ser uma concatenação truncada de IDs.
    const firstReservation = state.mine.find(r => state.checkout.includes(r.presenteId) && unpaid(r));
    const txid = firstReservation ? 'PS' + String(firstReservation.pedidoId).replace(/[^a-z0-9]/gi, '').slice(0, 23) : 'PRESENTES';
    const payload = app.buildPixPayload(app.selectedGift.pix, gifts.length > 1 ? txid : gifts[0].id);
    el('pix-copy-input').value = payload; app.renderPixQrCode(payload);
  }
  function render() {
    app.renderGifts(); app.updateHeaderState(); app.updateSelectedBanner(); renderMine(); renderSummary(); renderDeliveryThanks();
  }
  function renderMine() {
    const box = el('registry-mine'); if (!box) return;
    box.replaceChildren();
    const records = state.mine.filter(active);
    if (!records.length) { box.hidden = true; return; }
    box.hidden = false;
    const heading = document.createElement('h3'); heading.className = 'font-serif text-2xl mb-3'; heading.textContent = 'Meus presentes'; box.append(heading);
    const pending = records.filter(unpaid);
    if (pending.length > 1) {
      const all = document.createElement('button'); all.className = 'mb-3 text-sm underline text-olive-700'; all.textContent = 'Ver pagamento dos ' + pending.length + ' presentes pendentes'; all.disabled = state.busy;
      all.onclick = () => { state.checkout = pending.map(r => r.presenteId); aggregate(); app.selectPaymentMethod('pix'); old.go('pagamento'); }; box.append(all);
    }
    records.forEach(r => {
      const row = document.createElement('div'); row.className = 'border-t border-sand py-3 flex flex-wrap items-center justify-between gap-3';
      const title = document.createElement('div');
      const paid = r.pagamento === 'Pago', personal = delivery(r);
      title.innerHTML = '<strong class="block text-sm">' + escape(r.presenteNome) + '</strong><span class="text-xs ' + (paid || personal ? 'text-olive-700' : 'text-charcoal-500') + '">' + (personal ? 'Entrega pessoal confirmada · sem pagamento pelo site' : paid ? 'Pagamento confirmado' : 'Reservado · aguardando pagamento') + '</span>';
      row.append(title);
      if (!paid) {
        const actions = document.createElement('div'); actions.className = 'flex gap-3 text-xs';
        const pay = document.createElement('button'); pay.textContent = personal ? 'Ver entrega e avisar Pedro' : 'Ver pagamento'; pay.className = 'underline text-olive-700';
        pay.onclick = () => { state.checkout = [r.presenteId]; if (personal) { renderDeliveryThanks(); old.go('entrega'); } else { aggregate(); app.selectPaymentMethod(r.formaPagamento === 'Cartão' ? 'card' : 'pix'); old.go('pagamento'); } };
        const change = document.createElement('button'); change.textContent = 'Trocar presente'; change.className = 'underline text-terracotta-700';
        change.onclick = () => app.removeReservedGift(r.presenteId);
        pay.disabled = change.disabled = state.busy; actions.append(pay, change); row.append(actions);
      }
      box.append(row);
    });
  }
  function renderDeliveryThanks() {
    const list = el('delivery-gift-list'); if (!list) return;
    list.replaceChildren();
    state.mine.filter(r => state.checkout.includes(r.presenteId) && active(r) && delivery(r)).forEach(r => {
      const item = document.createElement('li'); item.textContent = r.presenteNome;
      const code = document.createElement('small'); code.textContent = r.presenteId + ' · Entrega pessoal confirmada'; item.append(code); list.append(item);
    });
  }
  function renderSummary() {
    const root = el('registry-summary'); if (!root) return;
    const gifts = basket();
    root.innerHTML = '<h2 class="font-serif text-3xl">Seus presentes</h2><p class="text-sm text-charcoal-500 mt-2">Confirme a escolha para reservar os itens para você.</p>';
    gifts.forEach(g => {
      const row = document.createElement('div'); row.className = 'mt-4 flex items-center justify-between gap-3 border-b border-sand pb-4';
      const label = document.createElement('span'); label.textContent = g.name + ' — ' + money(g.pix); label.className = 'text-sm';
      const remove = document.createElement('button'); remove.textContent = 'Remover'; remove.className = 'text-xs underline text-terracotta-700'; remove.disabled = state.busy;
      remove.onclick = () => {
        const reserved = state.mine.find(r => r.presenteId === g.id && active(r));
        if (reserved) app.removeReservedGift(g.id);
        else { state.drafts.delete(g.id); state.checkout = state.checkout.filter(x => x !== g.id); saveDrafts(); aggregate(); render(); }
      };
      row.append(label, remove); root.append(row);
    });
    if (gifts.length) {
      const total = document.createElement('p'); total.className = 'font-serif text-xl mt-5'; total.textContent = 'Total Pix: ' + money(gifts.reduce((n, g) => n + g.pix, 0)); root.append(total);
    }
    const confirm = document.createElement('button'); confirm.textContent = state.busy ? 'Salvando reserva…' : 'Confirmar e reservar';
    confirm.className = 'w-full mt-5 py-4 rounded-xl bg-terracotta-500 text-white font-medium disabled:opacity-50';
    confirm.disabled = !gifts.length || !state.ready || state.busy; confirm.onclick = () => app.confirmBasket();
    const back = document.createElement('button'); back.textContent = 'Escolher mais presentes'; back.className = 'w-full mt-3 py-3 text-sm underline'; back.onclick = () => old.go('lista');
    root.append(confirm, back);
  }

  app.init = function () {
    ui.init(); old.init(); this.unavailableGifts = [];
    const methods = ['pix', 'card', 'delivery'];
    this.selectPaymentMethod('pix');
    methods.forEach(method => el('option-' + method + '-box').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (methods.indexOf(method) + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : 2)) % methods.length;
      this.selectPaymentMethod(methods[index]); el('option-' + methods[index] + '-box').focus();
    }));
    if (!this.guestData?.id || !/^[a-f0-9]{64}$/i.test(this.guestData?.token || '') || typeof this.guestData?.name !== 'string') clearIdentity();
    this.updateGuestBadge();
    const draft = ui.storage.read('ps_registry_drafts');
    if (draft && this.guestData?.id && draft.guestId === this.guestData.id && Array.isArray(draft.ids)) state.drafts = new Set(draft.ids.filter(id => typeof id === 'string'));
    const status = document.createElement('div'); status.id = 'registry-message'; status.hidden = true; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    document.querySelector('main').prepend(status);
    const mine = document.createElement('section'); mine.id = 'registry-mine'; mine.className = 'rounded-2xl bg-ivory-50 border border-sand p-4'; mine.hidden = true;
    el('active-gift-banner').before(mine);
    el('view-resumo').innerHTML = '<div id="registry-summary" class="rounded-2xl border border-sand bg-ivory-50 p-5"></div>';
    render();
    const url = window.REGISTRY_CONFIG?.apiUrl;
    if (!url) { message('A conexão com a planilha ainda precisa ser configurada. As reservas ficam disponíveis após a configuração.', true); ui.loading(false); return; }
    try { state.bridge = new RegistryBridge(url); sync(true); }
    catch (err) { message(err.message, true); ui.loading(false); }
    setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  };

  app.handleGuestSubmit = async function (event) {
    event.preventDefault();
    if (state.busy || !el('guest-form').reportValidity()) return;
    el('form-error').classList.add('hidden');
    if (!state.bridge) { message('Configure a conexão com a planilha antes de registrar convidados.', true); return; }
    const name = el('input-guest-name').value.trim(); const phone = el('input-guest-phone').value.trim();
    if (!el('input-consent').checked) return;
    const success = await operation('Salvando sua identificação…', async () => {
      if (!state.canonicalPhone) throw new Error('A conexão da lista precisa ser atualizada pelo administrador para reconhecer cadastros existentes. Nenhum novo cadastro foi criado.');
      let guest;
      try { guest = await state.bridge.request('guest', { ...credentials(), clientToken: ui.secret('ps_registration_secret'), nome: name, telefone: phone, consentimento: true }); }
      catch (err) { if (err.code === 'RECOVERY_REQUIRED') { this.showRecovery(true); el('recovery-phone').value = phone; } throw err; }
      saveGuest(guest); ui.storage.remove('ps_registration_secret');
      state.mine = await state.bridge.request('mine', credentials());
      old.go('lista'); message('Identificação salva. Escolha os presentes que deseja oferecer.');
    });
    if (success && this.guestData?.recoveryCode) this.openAccount('Guarde seu código antes de continuar. Ele permite voltar à mesma identificação em outro aparelho.', false);
  };

  app.updateGuestBadge = function () {
    const connected = !!this.guestData?.token; el('guest-badge').classList.toggle('hidden', !connected);
    el('guest-name-pill').textContent = connected ? 'Minha conta' : 'Convidado';
  };
  app.showRecovery = function (show) {
    el('guest-form').hidden = show; el('recovery-form').hidden = !show;
    el('recovery-error').hidden = true; el('form-error').classList.add('hidden');
    if (show) el('recovery-phone').focus();
  };
  app.handleRecoverySubmit = async function (event) {
    event.preventDefault();
    if (state.busy) return;
    el('recovery-error').hidden = true;
    await operation('Recuperando seu acesso…', async () => {
      if (!state.recovery) throw new Error('A recuperação ainda precisa ser ativada pelo administrador. Você pode continuar no navegador em que já se identificou.');
      const guest = await state.bridge.request('recover', { telefone: el('recovery-phone').value, codigo: el('recovery-code').value, clientToken: ui.secret('ps_recovery_secret') });
      saveGuest(guest); ui.storage.remove('ps_recovery_secret'); state.drafts.clear(); state.checkout = [];
      state.mine = await state.bridge.request('mine', credentials()); old.go('lista');
      el('recovery-code').value = ''; message('Acesso recuperado. Seus presentes e pagamentos estão logo abaixo.');
    });
  };
  app.openAccount = async function (notice = '', refresh = true) {
    if (!this.guestData?.token) { this.goToPage('identificacao'); return; }
    if (state.busy) return;
    if (state.readableRecovery && refresh) {
      const success = await operation('Consultando seu código…', async () => {
        const result = await state.bridge.request('recovery', credentials());
        if (result.recoveryCode) { this.guestData.recoveryCode = result.recoveryCode; ui.storage.write('ps_guest_user', this.guestData); }
      });
      if (!success) return;
    }
    ui.account(this.guestData, async () => {
      const success = await operation('Preparando seu código…', async () => {
        // Botão explícito: substitui o código anterior caso o usuário não o tenha guardado.
        const result = await state.bridge.request('recovery', { ...credentials(), renew: true });
        this.guestData.recoveryCode = result.recoveryCode; ui.storage.write('ps_guest_user', this.guestData);
      });
      if (success) this.openAccount('Guarde este código. Se havia um código anterior, ele foi substituído.', false);
    }, () => {
      ui.closeAccount(); clearIdentity(); render(); this.showRecovery(false); old.go('identificacao');
      message('Você saiu apenas deste navegador. Suas reservas continuam salvas.');
    }, state.recovery, notice);
  };

  app.renderGifts = function () {
    const filtered = GIFTS_DATABASE.filter(g => (this.activeCategory === 'todos' || g.cat === this.activeCategory) && (!this.onlyPriority || g.priority) &&
      (!this.searchQuery || (g.name + ' ' + g.desc).toLowerCase().includes(this.searchQuery)));
    if (this.sortMode === 'price-asc') filtered.sort((a, b) => a.pix - b.pix);
    if (this.sortMode === 'price-desc') filtered.sort((a, b) => b.pix - a.pix);
    if (this.sortMode === 'name-asc') filtered.sort((a, b) => a.name.localeCompare(b.name));
    const available = GIFTS_DATABASE.filter(g => g.disponivel).length;
    const paid = GIFTS_DATABASE.filter(g => g.status === 'pago' || g.status === 'entrega_confirmada').length;
    const reserved = GIFTS_DATABASE.filter(g => g.status === 'reservado').length;
    const blocked = GIFTS_DATABASE.filter(g => g.status === 'indisponivel').length;
    el('gifts-counters').textContent = state.ready ? available + (available === 1 ? ' disponível' : ' disponíveis') + ' · ' + reserved + (reserved === 1 ? ' reservado' : ' reservados') + ' · ' + paid + (paid === 1 ? ' confirmado' : ' confirmados') + (blocked ? ' · ' + blocked + (blocked === 1 ? ' indisponível' : ' indisponíveis') : '') : 'Aguardando conexão';
    const grid = el('gift-cards-grid'); grid.replaceChildren(); el('gifts-empty-state').classList.toggle('hidden', filtered.length > 0);
    filtered.forEach(g => {
      const own = state.mine.find(r => r.presenteId === g.id && active(r)); const selected = state.drafts.has(g.id);
      const card = document.createElement('article'); card.className = 'rounded-2xl p-4 border flex flex-col justify-between ' + (selected ? 'bg-terracotta-50 border-terracotta-500' : 'bg-ivory-50 border-sand');
      const photo = window.PRODUCT_IMAGES?.[g.id];
      const description = g.desc && g.desc !== g.name ? '<p class="text-xs text-charcoal-500">' + escape(g.desc) + '</p>' : '';
      card.innerHTML = '<div>' + (photo ? '<img class="gift-photo" src="' + escape(photo.src) + '" alt="' + escape(photo.alt || g.name) + '" width="320" height="180" loading="lazy" decoding="async"><p class="gift-photo-note">Imagem ilustrativa</p>' : '') + '<span class="text-xs text-olive-700">' + escape(g.cat) + (g.priority ? ' · Prioridade' : '') + '</span><h3 class="font-serif text-xl my-2">' + escape(g.name) + '</h3>' + description + '</div><div class="mt-4"><strong class="text-olive-700">' + money(g.pix) + '</strong>' + (g.pix !== g.card ? '<span class="block text-xs mt-1">Cartão: ' + money(g.card) + '</span>' : '') + '</div>';
      const button = document.createElement('button'); button.className = 'w-full mt-4 py-3 rounded-xl border border-sand text-sm disabled:opacity-60';
      button.textContent = own ? (delivery(own) ? 'Sua entrega está confirmada' : own.pagamento === 'Pago' ? 'Pagamento confirmado' : 'Reservado para você') : selected ? 'Remover da seleção' : !g.disponivel && state.ready ? (['pago', 'entrega_confirmada'].includes(g.status) ? 'Presente confirmado' : 'Já reservado') : 'Escolher este presente';
      button.disabled = !state.ready || state.busy || !!own || !g.disponivel;
      button.onclick = () => selected ? this.unselectGift(g.id) : this.chooseGift(g.id); card.append(button); grid.append(card);
    });
  };
  app.chooseGift = function (id) {
    if (!state.ready || state.busy) return;
    if (!this.guestData?.token) { old.go('identificacao'); return; }
    const gift = GIFTS_DATABASE.find(g => g.id === id); if (!gift?.disponivel) return;
    state.drafts.add(id); state.checkout = []; saveDrafts(); render(); message('Presente adicionado. Você pode escolher outros ou confirmar a seleção.');
  };
  app.unselectGift = function (id) { state.drafts.delete(id); state.checkout = []; saveDrafts(); render(); };
  app.updateSelectedBanner = function () {
    const n = state.drafts.size; el('active-gift-banner').classList.toggle('hidden', !n);
    el('banner-gift-name').textContent = n + (n === 1 ? ' presente selecionado' : ' presentes selecionados');
  };
  app.updateHeaderState = function () {
    document.body.dataset.page = this.currentPage;
    const status = el('registry-message'); if (status) status.hidden = !status.textContent || status.dataset.page !== this.currentPage;
    ui.updateCarousel();
    el('header-back-btn').classList.toggle('opacity-0', this.currentPage === 'capa');
    el('header-back-btn').classList.toggle('pointer-events-none', this.currentPage === 'capa');
    el('selected-badge-count').classList.toggle('hidden', !state.drafts.size);
  };
  app.goToPage = function (id, history = true) {
    if (state.busy) return;
    if (id === 'identificacao' && this.guestData?.token) id = 'lista';
    if (id === 'identificacao') this.showRecovery(false);
    if (id === 'resumo') { state.checkout = [...state.drafts]; renderSummary(); }
    old.go(id, history);
  };
  app.openCartOrList = function () { this.goToPage(state.drafts.size ? 'resumo' : 'lista'); };
  app.fillSummaryData = aggregate;
  app.confirmBasket = async function () {
    if (!this.guestData?.token) { old.go('identificacao'); return; }
    const ids = basket().map(g => g.id); if (!ids.length) return;
    await operation('Confirmando seus presentes…', async () => {
      const result = await state.bridge.request('reserve', { ...credentials(), presenteIds: ids, formaPagamento: 'Pix' });
      state.checkout = ids; ids.forEach(id => state.drafts.delete(id)); accept(result); aggregate();
      this.selectPaymentMethod('pix'); old.go('pagamento'); message('Reserva confirmada. Os presentes já estão indisponíveis para outras pessoas.');
    });
  };
  app.proceedPaymentChoice = async function () {
    const personal = this.selectedPayment === 'delivery';
    await operation(personal ? 'Confirmando sua entrega pessoal…' : 'Preparando o pagamento…', async () => {
      const ids = state.checkout; if (!ids.length) throw new Error('Selecione um presente.');
      if (personal && !state.personalDelivery) throw new Error('A entrega pessoal ainda precisa ser ativada na conexão da lista. Sua reserva continua salva; tente novamente mais tarde.');
      const result = await state.bridge.request(personal ? 'personal-delivery' : 'reserve', { ...credentials(), presenteIds: ids, ...(personal ? {} : { formaPagamento: this.selectedPayment === 'pix' ? 'Pix' : 'Cartão' }) });
      accept(result);
      if (personal) {
        if (state.mine.filter(r => ids.includes(r.presenteId) && active(r) && delivery(r)).length !== ids.length) throw new Error('Não foi possível confirmar todos os itens. Confira Meus presentes antes de tentar novamente.');
        renderDeliveryThanks(); old.go('entrega'); return;
      }
      if (state.mine.filter(r => ids.includes(r.presenteId) && unpaid(r)).length !== ids.length) {
        old.go('lista'); throw new Error('O pagamento já foi confirmado. Confira Meus presentes.');
      }
      aggregate(); old.go(this.selectedPayment === 'pix' ? 'pix' : 'cartao');
    });
  };
  app.removeReservedGift = async function (id) {
    const personal = state.mine.some(r => r.presenteId === id && active(r) && delivery(r));
    if (state.busy || (personal && !window.confirm('Cancelar a entrega pessoal deste presente? Ele ficará disponível para outras pessoas. Só confirme se você não pretende mais entregá-lo.'))) return;
    await operation('Liberando o presente…', async () => {
      accept(await state.bridge.request('release', { ...credentials(), presenteIds: [id] }));
      state.checkout = state.checkout.filter(x => x !== id); state.drafts.delete(id); old.go('lista'); message('Presente liberado. Você já pode escolher outro.');
    });
  };
  function whatsapp(card) {
    const gifts = basket(); if (!gifts.length) return;
    const lines = gifts.map(g => g.name + ' (' + g.id + '): ' + money(card ? g.card : g.pix));
    const total = gifts.reduce((n, g) => n + (card ? g.card : g.pix), 0);
    const text = 'Olá, Pedro e Samara! Sou ' + app.guestData.name + '.\n\n' + lines.join('\n') + '\nTotal: ' + money(total) + '\n\n' +
      (card ? 'Pode me enviar o link para pagamento no cartão?' : 'Realizei o Pix e vou anexar o comprovante nesta conversa.');
    window.open('https://wa.me/557588861151?text=' + encodeURIComponent(text), '_blank', 'noopener,noreferrer');
  }
  app.sendPixVoucherWhatsApp = () => whatsapp(false);
  app.openWhatsAppCard = () => whatsapp(true);
  app.openWhatsAppDelivery = function () {
    const records = state.mine.filter(r => state.checkout.includes(r.presenteId) && active(r) && delivery(r));
    if (!records.length) { message('Confira sua entrega em Meus presentes antes de avisar Pedro.', true); return; }
    const text = 'Olá, Pedro e Samara! Sou ' + app.guestData.name + '.\n\nConfirmei no site que vou providenciar por conta própria e entregar pessoalmente:\n\n' +
      records.map(r => '• ' + r.presenteNome + ' (' + r.presenteId + ')').join('\n') +
      '\n\nOs itens já estão separados para mim. Não farei o pagamento deles pelo site. Podemos combinar a entrega?';
    window.open('https://wa.me/557588861151?text=' + encodeURIComponent(text), '_blank', 'noopener,noreferrer');
  };
})();

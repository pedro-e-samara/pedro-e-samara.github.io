/* Interface compartilhada: carregamentos, fotos e identificação recuperável. */
window.RegistryUI = (() => {
  const el = id => document.getElementById(id);
  let timer, carouselTimer, carouselRoot, carouselToggle;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let carouselPaused = motion.matches, carouselHovered = false, carouselFocused = false;
  function updateCarousel() {
    clearTimeout(carouselTimer);
    if (!carouselRoot) return;
    carouselToggle.textContent = carouselPaused ? 'Retomar fotos' : 'Pausar fotos';
    carouselToggle.setAttribute('aria-pressed', String(carouselPaused));
    if (carouselPaused || carouselHovered || carouselFocused || app.currentPage !== 'capa' || document.visibilityState !== 'visible' || document.querySelector('dialog:modal')) return;
    carouselTimer = setTimeout(() => { app.nextPhoto(); }, 6000);
  }
  const storage = {
    read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } },
    write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch (_) {} }
  };
  function loading(show, title, detail) {
    const dialog = el('registry-loader'); clearTimeout(timer);
    if (!show) { if (dialog.open) dialog.close(); updateCarousel(); return; }
    el('registry-loader-title').textContent = title || 'Só um instante…';
    el('registry-loader-detail').textContent = detail || 'Estamos salvando sua escolha. Aguarde a confirmação.';
    el('registry-loader-slow').hidden = true;
    if (dialog.open && !dialog.matches(':modal')) dialog.close();
    if (!dialog.open) dialog.showModal();
    updateCarousel();
    timer = setTimeout(() => { el('registry-loader-slow').hidden = false; }, 10000);
  }
  function secret(key) {
    let token = storage.read(key);
    if (!/^[a-f0-9]{64}$/.test(token || '')) {
      token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
      if (!storage.write(key, token)) throw new Error('Permita o armazenamento deste site no navegador para salvar seu acesso com segurança.');
    }
    return token;
  }
  function init() {
    el('registry-loader').addEventListener('cancel', event => event.preventDefault());
    const track = el('carousel-track'), dots = el('dot-0').parentElement;
    track.replaceChildren(); dots.replaceChildren();
    for (let i = 0; i < 9; i++) {
      const image = document.createElement('img'); image.id = 'carousel-img-' + i;
      const source = 'assets/couple/pedro-samara-' + String(i + 1).padStart(2, '0') + '.webp';
      if (i === 0) image.src = source; else image.dataset.src = source;
      image.alt = i === 8 ? 'Pedro e Samara em um beijo' : 'Pedro e Samara — fotografia ' + (i + 1);
      image.className = 'absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ' + (i ? 'opacity-0' : 'opacity-100');
      image.loading = i ? 'lazy' : 'eager'; image.width = 1600; image.height = 900; track.append(image);
      const button = document.createElement('button'); button.id = 'dot-' + i; button.type = 'button';
      button.setAttribute('aria-label', 'Ver fotografia ' + (i + 1)); button.onclick = () => app.setPhoto(i); dots.append(button);
    }
    const setPhoto = app.setPhoto.bind(app);
    app.setPhoto = function (index) {
      if (!Number.isInteger(index) || index < 0 || index >= 9) return;
      const image = el('carousel-img-' + index); if (!image.getAttribute('src')) image.src = image.dataset.src;
      setPhoto(index);
      for (let i = 0; i < 9; i++) { el('dot-' + i).setAttribute('aria-current', i === index ? 'true' : 'false'); el('carousel-img-' + i).setAttribute('aria-hidden', i === index ? 'false' : 'true'); }
      const next = el('carousel-img-' + ((index + 1) % 9)); if (!next.getAttribute('src')) next.src = next.dataset.src;
      updateCarousel();
    };
    app.photoCount = 9; app.setPhoto(0);
    carouselRoot = el('couple-carousel'); carouselToggle = document.createElement('button');
    carouselToggle.id = 'carousel-toggle'; carouselToggle.type = 'button'; carouselToggle.className = 'registry-carousel-toggle';
    carouselToggle.setAttribute('aria-controls', 'carousel-track');
    carouselToggle.onclick = () => { carouselPaused = !carouselPaused; if (!carouselPaused) carouselFocused = false; updateCarousel(); };
    dots.append(carouselToggle);
    carouselRoot.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') { carouselHovered = true; updateCarousel(); } });
    carouselRoot.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') { carouselHovered = false; updateCarousel(); } });
    carouselRoot.addEventListener('focusin', event => { carouselFocused = event.target.matches(':focus-visible'); updateCarousel(); });
    carouselRoot.addEventListener('focusout', () => { queueMicrotask(() => { if (!carouselRoot.contains(document.activeElement)) { carouselFocused = false; updateCarousel(); } }); });
    document.addEventListener('visibilitychange', updateCarousel);
    motion.addEventListener('change', () => { if (motion.matches) carouselPaused = true; updateCarousel(); });
    el('registry-loader').addEventListener('close', updateCarousel);
    updateCarousel();
    const dialog = document.createElement('dialog'); dialog.id = 'registry-account-dialog'; dialog.className = 'registry-dialog';
    dialog.setAttribute('aria-labelledby', 'registry-account-title'); document.body.append(dialog);
    dialog.addEventListener('close', updateCarousel);
    const phoneInput = el('input-guest-phone'); phoneInput.maxLength = 32; phoneInput.autocomplete = 'tel';
    const review = document.createElement('div'); review.className = 'registry-phone-review';
    review.innerHTML = '<p id="phone-preview" aria-live="polite">Informe seu telefone com DDD. Espaços, parênteses e traços são aceitos.</p><label class="flex items-start gap-2 text-xs leading-relaxed"><input type="checkbox" id="phone-confirm" required class="mt-1"><span>Conferi o telefone acima e confirmo que está correto.</span></label>';
    phoneInput.parentElement.parentElement.append(review);
    const preview = () => {
      el('phone-confirm').checked = false; phoneInput.setCustomValidity('');
      if (!phoneInput.value.trim()) { el('phone-preview').textContent = 'Informe seu telefone com DDD. Espaços, parênteses e traços são aceitos.'; return; }
      try {
        const parsed = RegistryPhone.parse(phoneInput.value);
        el('phone-preview').textContent = parsed.full ? 'Telefone que será usado: ' + RegistryPhone.display(parsed.full) + (parsed.addedNinth ? ' — incluímos o nono dígito do celular. Confira.' : '.') : 'Sem DDD, só é possível recuperar um cadastro existente sem ambiguidade. Para um primeiro cadastro, inclua o DDD.';
      } catch (error) { phoneInput.setCustomValidity(error.message); el('phone-preview').textContent = error.message; }
    };
    phoneInput.addEventListener('input', preview);
    const form = document.createElement('form'); form.id = 'recovery-form'; form.hidden = true;
    form.className = 'rounded-2xl border border-sand bg-ivory-50 p-5 sm:p-6';
    form.innerHTML = '<h3 class="font-serif text-2xl">Voltar à minha identificação</h3><p class="text-sm text-charcoal-500 mt-2">Use o telefone e o código que você guardou. Suas reservas continuam na mesma conta.</p><label class="registry-field" for="recovery-phone">Telefone com DDD</label><input class="registry-input" id="recovery-phone" type="tel" autocomplete="tel" required maxlength="20" placeholder="(75) 98888-7777"><label class="registry-field" for="recovery-code">Código de recuperação</label><input class="registry-input" id="recovery-code" autocomplete="off" autocapitalize="characters" spellcheck="false" required maxlength="24" placeholder="ABCD-1234-EF56-7890"><p id="recovery-error" class="registry-error" role="alert" hidden></p><button class="registry-primary" type="submit">Recuperar meu acesso</button><button class="registry-secondary" type="button" onclick="app.showRecovery(false)">Ainda não me identifiquei</button><p class="text-xs text-charcoal-500 mt-4">O código é entregue aqui no site, não por SMS. Perdeu o código e não tem outro navegador conectado? <a href="https://wa.me/557588861151" target="_blank" rel="noopener noreferrer" class="underline">Fale com Pedro</a>.</p>';
    form.onsubmit = event => app.handleRecoverySubmit(event); el('guest-form').after(form);
    el('recovery-phone').maxLength = 32;
    document.querySelector('label[for="recovery-phone"]').textContent = 'Telefone (DDD recomendado)';
    const recoveryHint = document.createElement('p'); recoveryHint.className = 'text-xs text-charcoal-500 mt-2';
    recoveryHint.textContent = 'Aceitamos pontuação e celular sem o nono dígito. Sem DDD, o telefone precisa corresponder a um único cadastro.';
    el('recovery-phone').after(recoveryHint);
    const recover = document.createElement('button'); recover.type = 'button'; recover.id = 'open-recovery'; recover.className = 'registry-secondary';
    recover.textContent = 'Já participei — recuperar meu acesso'; recover.onclick = () => app.showRecovery(true); el('guest-form').append(recover);
  }
  function account(guest, onRenew, onLogout, capable, notice = '') {
    const dialog = el('registry-account-dialog'); dialog.replaceChildren();
    const header = document.createElement('div'); header.className = 'registry-dialog-header';
    const title = document.createElement('h2'); title.id = 'registry-account-title'; title.textContent = 'Seu acesso à lista';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'registry-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Fechar'); close.onclick = () => dialog.close(); header.append(title, close); dialog.append(header);
    const identity = document.createElement('p'); identity.textContent = guest.name + ' · ' + guest.phone; dialog.append(identity);
    const info = document.createElement('p'); info.textContent = 'Neste navegador, sua identificação é lembrada automaticamente. Para entrar em outro aparelho, guarde seu código e use o mesmo telefone.'; dialog.append(info);
    if (guest.recoveryCode) {
      const code = document.createElement('code'); code.className = 'registry-code'; code.textContent = guest.recoveryCode; dialog.append(code);
      const copy = document.createElement('button'); copy.className = 'registry-secondary'; copy.textContent = 'Copiar código';
      copy.onclick = async () => { try { await navigator.clipboard.writeText(guest.recoveryCode); copy.textContent = 'Código copiado'; } catch (_) { code.focus(); copy.textContent = 'Selecione o código acima e copie'; } }; dialog.append(copy);
      const download = document.createElement('button'); download.className = 'registry-secondary'; download.textContent = 'Baixar meu código';
      download.onclick = () => {
        const blob = new Blob(['Pedro & Samara — acesso à lista\nNome: ' + guest.name + '\nTelefone: ' + guest.phone + '\nCódigo: ' + guest.recoveryCode + '\nSite: ' + location.origin + '\n\nGuarde este arquivo em local privado. Não compartilhe o código.\n'], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'meu-acesso-pedro-e-samara.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }; dialog.append(download);
    } else {
      const button = document.createElement('button'); button.className = 'registry-secondary'; button.textContent = 'Gerar meu código de recuperação'; button.disabled = !capable; button.onclick = onRenew; dialog.append(button);
      if (!capable) { const p = document.createElement('p'); p.textContent = 'A recuperação estará disponível após a atualização da conexão com a lista.'; dialog.append(p); }
    }
    const note = document.createElement('div'); note.className = 'registry-note'; note.textContent = notice || 'O código permite acessar e trocar seus presentes. Guarde-o em local seguro. Não há envio de SMS nem cobrança.'; dialog.append(note);
    const gifts = document.createElement('button'); gifts.className = 'registry-primary'; gifts.textContent = 'Ir para meus presentes'; gifts.onclick = () => { dialog.close(); app.goToPage('lista'); }; dialog.append(gifts);
    const logout = document.createElement('button'); logout.className = 'registry-secondary'; logout.textContent = 'Sair deste navegador'; logout.onclick = onLogout; dialog.append(logout);
    if (!dialog.open) dialog.showModal();
    updateCarousel();
  }
  return { init, loading, storage, secret, account, updateCarousel, closeAccount: () => el('registry-account-dialog').close() };
})();

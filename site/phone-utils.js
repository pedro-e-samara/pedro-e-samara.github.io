/* Mesmas regras de parsePhone_ no Code.gs; os testes verificam a equivalência. */
window.RegistryPhone = (() => {
  function invalid(message) { throw new Error(message); }
  function parse(value) {
    const input = String(value == null ? '' : value).trim();
    if (input.length > 40 || /[^\d\s()+.\-]/.test(input)) invalid('Informe um telefone válido. Use somente números e pontuação de telefone.');
    let digits = input.replace(/\D/g, '');
    if (/^\+/.test(input) && (!/^55/.test(digits) || ![12, 13].includes(digits.length))) invalid('Use +55 seguido do DDD e do telefone completo.');
    if (/^0055/.test(digits) && [14, 15].includes(digits.length)) digits = digits.slice(2);
    if (/^55/.test(digits) && [12, 13].includes(digits.length)) digits = digits.slice(2);
    if (digits[0] === '0' && [11, 12].includes(digits.length)) digits = digits.slice(1);
    let ddd = '', local = digits;
    if ([10, 11].includes(digits.length)) {
      ddd = digits.slice(0, 2); local = digits.slice(2);
      const validDDD = '11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' ');
      if (!validDDD.includes(ddd)) invalid('DDD inválido. Confira o código de área do telefone.');
    }
    if (!(/^[2-9]\d{7}$/.test(local) || /^9\d{8}$/.test(local)) || /^(\d)\1+$/.test(local)) invalid('Telefone inválido. Confira a quantidade de dígitos e o número informado.');
    const mobile = local.length === 9 || /^[89]/.test(local);
    const normalizedLocal = mobile && local.length === 8 ? '9' + local : local;
    return { full: ddd ? ddd + normalizedLocal : null, ddd, local: normalizedLocal,
      localKey: mobile ? normalizedLocal.slice(1) : normalizedLocal, mobile,
      addedNinth: mobile && local.length === 8 };
  }
  function display(value) {
    const phone = parse(value);
    return (phone.ddd ? '(' + phone.ddd + ') ' : '') + phone.local.slice(0, -4) + '-' + phone.local.slice(-4);
  }
  return { parse, display };
})();

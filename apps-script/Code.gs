/**
 * Controle de Opções — API da planilha (Google Apps Script)
 *
 * Script VINCULADO à planilha "Controle de Opções" (Extensões → Apps Script).
 * Publicado como App da Web: executar como "Eu", acesso "Qualquer pessoa".
 *
 * Os dados do app são um único documento JSON (o mesmo formato do antigo opcoes.json).
 * Ele fica na aba técnica "_dados", dividido em pedaços (uma célula aceita no máximo 50 mil
 * caracteres). As abas "Ordens", "Aportes" e "Travas" são cópias legíveis, regravadas a cada
 * gravação — servem só para consulta: editar nelas não muda nada no app.
 *
 * Protocolo (somente POST, corpo JSON enviado como text/plain para evitar preflight CORS):
 *   { token, action: "ler" }                          → { ok, versao, dados, gravadoEm }
 *   { token, action: "versao" }                       → { ok, versao, gravadoEm }
 *   { token, action: "gravar", dados, versaoBase,
 *     forcar }                                        → { ok, versao } ou { ok:false, conflito:true, versao }
 *   { token, action: "backups" }                      → { ok, backups: [{ data, versao, ordens }] }
 *   { token, action: "lerBackup", data }              → { ok, dados }
 *
 * Backup: na primeira gravação de cada dia, a versão anterior (como estava no fim do dia
 * anterior) é copiada para a aba "_backups". Ficam os últimos MANTER_BACKUPS dias.
 *
 * Nenhum segredo neste arquivo: o token fica em Propriedades do script (chave TOKEN),
 * gerado por setupToken().
 *
 * Funções para rodar no editor: setupSheets(), setupToken(), trocarToken(), testarApi().
 */

/** @OnlyCurrentDoc */

const ABA_DADOS = '_dados';
const ABA_BACKUPS = '_backups';
const PEDACO = 45000;          // caracteres por célula (limite do Sheets: 50 mil)
const MANTER_BACKUPS = 60;     // dias de backup guardados
const ESPERA_LOCK_MS = 30000;
const FUSO = 'America/Sao_Paulo';

// ---------------------------------------------------------------------------
// Entrada HTTP
// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    let req;
    try {
      req = JSON.parse((e && e.postData && e.postData.contents) || '');
    } catch (_) {
      throw erroApi_('Corpo da requisição não é um JSON válido.');
    }
    if (!req || typeof req !== 'object') throw erroApi_('Corpo da requisição deve ser um objeto JSON.');
    validarToken_(req.token);

    if (req.action === 'ler') return responder_(ler_());
    if (req.action === 'versao') return responder_(versao_());
    if (req.action === 'gravar') return responder_(comLock_(() => gravar_(req)));
    if (req.action === 'backups') return responder_(listarBackups_());
    if (req.action === 'lerBackup') return responder_(lerBackup_(req.data));
    throw erroApi_('Ação desconhecida: "' + req.action + '".');
  } catch (err) {
    const msg = err && err.api ? err.message : 'Erro interno: ' + (err && err.message ? err.message : err);
    return responder_({ ok: false, erro: msg });
  }
}

// Abrir a URL no navegador só confirma que o script está publicado.
function doGet() {
  return responder_({ ok: true, app: 'Controle de Opções', mensagem: 'API no ar. O app usa POST.' });
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function erroApi_(mensagem) {
  const e = new Error(mensagem);
  e.api = true;
  return e;
}

function validarToken_(token) {
  const esperado = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!esperado) throw erroApi_('Token não configurado no servidor. Rode setupToken() no editor.');
  if (typeof token !== 'string' || !iguais_(token, esperado)) throw erroApi_('Token inválido.');
}

// Comparação em tempo constante (não revela quantos caracteres coincidem).
function iguais_(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

function comLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(ESPERA_LOCK_MS)) throw erroApi_('Planilha ocupada. Tente de novo em instantes.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Documento principal (aba _dados): B1 = versão, B2 = gravado em, A4.. = pedaços do JSON
// ---------------------------------------------------------------------------

function abaDados_() {
  const aba = SpreadsheetApp.getActive().getSheetByName(ABA_DADOS);
  if (!aba) throw erroApi_('Aba "' + ABA_DADOS + '" não existe. Rode setupSheets() no editor.');
  return aba;
}

function lerDocumento_() {
  const aba = abaDados_();
  const versao = Number(aba.getRange('B1').getValue()) || 0;
  const gravadoEm = String(aba.getRange('B2').getValue() || '');
  const ultima = aba.getLastRow();
  const texto = ultima >= 4 ? aba.getRange(4, 1, ultima - 3, 1).getValues().map(l => String(l[0])).join('') : '';
  return { versao: versao, gravadoEm: gravadoEm, texto: texto };
}

function ler_() {
  const doc = lerDocumento_();
  return { ok: true, versao: doc.versao, gravadoEm: doc.gravadoEm, dados: doc.texto ? JSON.parse(doc.texto) : null };
}

function versao_() {
  const aba = abaDados_();
  return { ok: true, versao: Number(aba.getRange('B1').getValue()) || 0, gravadoEm: String(aba.getRange('B2').getValue() || '') };
}

function validarDados_(d) {
  if (!d || typeof d !== 'object' || d.versao !== 1 || !Array.isArray(d.ordens)) {
    throw erroApi_('Os dados enviados não são do Controle de Opções.');
  }
}

function gravar_(req) {
  validarDados_(req.dados);
  const aba = abaDados_();
  const atual = lerDocumento_();
  if (!req.forcar && Number(req.versaoBase) !== atual.versao) {
    return { ok: false, conflito: true, versao: atual.versao, gravadoEm: atual.gravadoEm };
  }
  const agora = new Date();
  // backup do dia: guarda como os dados estavam antes da primeira gravação de hoje
  if (atual.texto) backupDoDia_(atual, agora);

  const texto = JSON.stringify(req.dados);
  const pedacos = [];
  for (let i = 0; i < texto.length; i += PEDACO) pedacos.push([texto.slice(i, i + PEDACO)]);
  const ultima = aba.getLastRow();
  if (ultima >= 4) aba.getRange(4, 1, ultima - 3, 1).clearContent();
  if (pedacos.length) aba.getRange(4, 1, pedacos.length, 1).setValues(pedacos);
  const versao = atual.versao + 1, quando = Utilities.formatDate(agora, FUSO, "yyyy-MM-dd'T'HH:mm:ss");
  aba.getRange('B1').setValue(versao);
  aba.getRange('B2').setValue(quando);
  try { atualizarAbasLegiveis_(req.dados); } catch (e) { console.warn('Abas legíveis: ' + e.message); }
  return { ok: true, versao: versao, gravadoEm: quando };
}

// ---------------------------------------------------------------------------
// Backups (aba _backups): A = data, B = versão, C = nº de ordens, D.. = pedaços do JSON
// ---------------------------------------------------------------------------

function abaBackups_() {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(ABA_BACKUPS) || ss.insertSheet(ABA_BACKUPS);
}

function backupDoDia_(atual, agora) {
  const aba = abaBackups_();
  const hoje = Utilities.formatDate(agora, FUSO, 'yyyy-MM-dd');
  const ultima = aba.getLastRow();
  const datas = ultima >= 2 ? aba.getRange(2, 1, ultima - 1, 1).getDisplayValues().map(l => l[0]) : [];
  if (datas.indexOf(hoje) >= 0) return;
  const pedacos = [];
  for (let i = 0; i < atual.texto.length; i += PEDACO) pedacos.push(atual.texto.slice(i, i + PEDACO));
  let ordens = 0;
  try { ordens = JSON.parse(atual.texto).ordens.length; } catch (e) { /* ignora */ }
  const linha = [hoje, atual.versao, ordens].concat(pedacos);
  aba.insertRowAfter(1);
  aba.getRange(2, 1, 1, linha.length).setNumberFormat('@').setValues([linha.map(String)]);
  const total = aba.getLastRow() - 1;
  if (total > MANTER_BACKUPS) aba.deleteRows(MANTER_BACKUPS + 2, total - MANTER_BACKUPS);
}

function listarBackups_() {
  const aba = abaBackups_();
  const ultima = aba.getLastRow();
  const l = ultima >= 2 ? aba.getRange(2, 1, ultima - 1, 3).getDisplayValues() : [];
  return { ok: true, backups: l.filter(x => x[0]).map(x => ({ data: x[0], versao: Number(x[1]), ordens: Number(x[2]) })) };
}

function lerBackup_(data) {
  const aba = abaBackups_();
  const ultima = aba.getLastRow();
  if (ultima < 2) throw erroApi_('Não há backups.');
  const linhas = aba.getRange(2, 1, ultima - 1, aba.getLastColumn()).getDisplayValues();
  const l = linhas.find(x => x[0] === data);
  if (!l) throw erroApi_('Backup de ' + data + ' não encontrado.');
  return { ok: true, data: data, dados: JSON.parse(l.slice(3).join('')) };
}

// ---------------------------------------------------------------------------
// Abas legíveis (só consulta)
// ---------------------------------------------------------------------------

function regravarAba_(nome, cabecalho, linhas) {
  const ss = SpreadsheetApp.getActive();
  const aba = ss.getSheetByName(nome) || ss.insertSheet(nome);
  aba.clearContents();
  const todas = [cabecalho].concat(linhas);
  aba.getRange(1, 1, todas.length, cabecalho.length).setValues(todas);
  aba.getRange(1, 1, 1, cabecalho.length).setFontWeight('bold');
  aba.setFrozenRows(1);
}

function atualizarAbasLegiveis_(d) {
  const series = d.series || {}, estruturas = d.estruturas || {};
  const ordens = d.ordens.slice().sort((a, b) => String(b.dataHora).localeCompare(String(a.dataHora)));
  regravarAba_('Ordens', ['Data e hora', 'Papel', 'Ativo', 'Lado', 'Quantidade', 'Preço', 'Strike', 'Vencimento', 'Custo', 'Trava', 'Origem'],
    ordens.map(o => {
      const s = series[o.ticker] || {};
      return [String(o.dataHora || '').replace('T', ' '), o.ticker, s.ativo || '', o.lado === 'C' ? 'Compra' : o.lado === 'V' ? 'Venda' : String(o.lado || ''),
        Number(o.qtd) || 0, Number(o.preco) || 0, s.strike || '', s.vencimento || '', Number(o.custo) || 0,
        o.estrutura && estruturas[o.estrutura] ? estruturas[o.estrutura].nome : '', o.origem || ''];
    }));
  regravarAba_('Aportes', ['Data', 'Valor', 'Observação'], (d.aportes || []).map(a => [a.data, Number(a.valor) || 0, a.obs || '']));
  regravarAba_('Travas', ['Nome', 'Criada em', 'Ordens'], Object.keys(estruturas).map(id => [
    estruturas[id].nome, String(estruturas[id].criadaEm || '').slice(0, 10), d.ordens.filter(o => o.estrutura === id).map(o => o.ticker).join(' + ')]));
}

// ---------------------------------------------------------------------------
// Instalação (rodar no editor)
// ---------------------------------------------------------------------------

/** Cria as abas técnicas. Pode ser rodada de novo sem risco: nunca apaga dados. */
function setupSheets() {
  const ss = SpreadsheetApp.getActive();
  let aba = ss.getSheetByName(ABA_DADOS);
  if (!aba) {
    aba = ss.insertSheet(ABA_DADOS);
    aba.getRange('A1:A3').setValues([['versão'], ['gravado em'], ['dados (JSON em pedaços, a partir da linha 4) — não edite esta aba']]);
    aba.getRange('B1').setValue(0);
  }
  aba.getRange('A:A').setNumberFormat('@');
  aba.getRange('B2').setNumberFormat('@');
  const bk = abaBackups_();
  if (bk.getLastRow() < 1) bk.getRange(1, 1, 1, 4).setValues([['Data', 'Versão', 'Ordens', 'Dados (JSON em pedaços)']]).setFontWeight('bold');
  bk.setFrozenRows(1);
  Logger.log('Abas "' + ABA_DADOS + '" e "' + ABA_BACKUPS + '" prontas. As abas Ordens, Aportes e Travas aparecem na primeira gravação.');
}

/**
 * Gera o token secreto e guarda em Propriedades do script (chave TOKEN).
 * Se já existir um token, NÃO troca (para trocar, rode trocarToken()).
 */
function setupToken() {
  if (PropertiesService.getScriptProperties().getProperty('TOKEN')) {
    Logger.log('Já existe um token; ele NÃO foi alterado. Veja em Configurações do projeto → Propriedades do script. Para gerar outro, rode trocarToken().');
    return;
  }
  trocarToken();
}

/** Gera um token novo (64 caracteres hexadecimais) e substitui o atual. */
function trocarToken() {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('TOKEN', token);
  Logger.log('Novo token (copie e guarde no gerenciador de senhas):\n' + token);
}

/** Testa a API sem gravar nada: lê a versão e os dados atuais. */
function testarApi() {
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token) throw new Error('Rode setupToken() antes.');
  const chamar = corpo => JSON.parse(doPost({ postData: { contents: JSON.stringify(Object.assign({ token: token }, corpo)) } }).getContent());
  const r1 = chamar({ action: 'versao' });
  if (!r1.ok) throw new Error('versao: ' + r1.erro);
  Logger.log('✓ versao: ' + r1.versao);
  const r2 = chamar({ action: 'ler' });
  if (!r2.ok) throw new Error('ler: ' + r2.erro);
  Logger.log('✓ ler: ' + (r2.dados ? r2.dados.ordens.length + ' ordens' : 'planilha ainda vazia (envie os dados pelo app)'));
  const r3 = JSON.parse(doPost({ postData: { contents: JSON.stringify({ token: 'errado', action: 'versao' }) } }).getContent());
  if (r3.ok) throw new Error('token errado foi aceito!');
  Logger.log('✓ token errado recusado');
  Logger.log('Todos os testes passaram.');
}

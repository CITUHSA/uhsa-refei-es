# Marcação de Refeições

Aplicação web para marcação semanal de refeições de utentes (até 100 ativos).

- **Utentes**: leem o QR code, escolhem o idioma (12 idiomas) e entram com o **número de PI** + **PIN**.
  Marcam ao **domingo, das 08h00 às 23h59**, as refeições da semana seguinte (segunda a domingo):
  pequeno-almoço, almoço, lanche, jantar e ceia. A opção *Especial* abre uma caixa de texto.
  Depois de submeter, só o administrador pode consultar ou alterar.
- **Administrador** (link "Administração" no fundo da página; utilizador admin):
  gestão de utentes (PIN gerado automaticamente), notas gerais por utente, marcações, refeições e opções,
  regras, horários, notas por dia, resumos semanal/diário em PDF, QR code, alteração de password e registo de atividade.

## Arquitetura

| Parte | Onde | Conteúdo |
|---|---|---|
| Interface (este repositório) | GitHub Pages | index.html, app.js, i18n.js, style.css, config.js |
| Servidor + dados | Google Apps Script da mesma conta Google | backend/Code.gs → folha de cálculo privada "Marcação de Refeições — DADOS" |

Separação de dados: o servidor só devolve a cada utente os seus próprios dados (nome, notas, estado da submissão);
as ações de administração exigem sessão de administrador; PINs e password são guardados apenas como *hash*.
A folha de dados fica privada na conta Google e não é acessível a partir da app.

## Instalação (uma vez)

1. **Servidor** — em <https://script.google.com> (conta servicouhsa@gmail.com): *Novo projeto* →
   colar backend/Code.gs em Code.gs. Em *Definições do projeto* ativar "Mostrar appsscript.json" e colar backend/appsscript.json.
   Executar a função setup (autorizar). *Implementar → Nova implementação → App da Web*:
   executar como **Eu**, acesso **Qualquer pessoa**. Copiar o URL terminado em /exec.
2. **Interface** — colar esse URL em config.js (API_URL). Em *Settings → Pages* do repositório, publicar a partir do ramo main (pasta raiz).
3. **QR code** — qrcode.png aponta para https://cituhsa.github.io/uhsa-refei-es/; também pode ser gerado/impresso em *Administração → Definições*.
4. **Email** — no Apps Script, executar enviarEmailAcesso (envia link + QR code para servicouhsa@gmail.com).

Password inicial do administrador: definida apenas na cópia do Code.gs no Apps Script (DEFAULT_ADMIN_PASS), nunca neste repositório público. **Altere-a em Definições após o primeiro acesso.**

## Atualizar o servidor

Depois de alterar Code.gs: *Implementar → Gerir implementações → editar → Versão: Nova versão*. O URL mantém-se.

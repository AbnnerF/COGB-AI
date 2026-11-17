COGB-AI — CONFIGURAÇÃO PARA DEPLEXO (WORKER)

IMPORTANTE: crie um NOVO aplicativo do tipo Worker na Deplexo.
A documentação da plataforma informa que o tipo de aplicativo não pode ser convertido
depois da criação. Não apague o aplicativo antigo até testar o novo.

O arquivo de configuração deplexo.yaml define:
- type: worker (processo contínuo, sem servidor HTTP público)
- build pelo Dockerfile do projeto
- inicialização do Node.js com limite conservador de heap V8

ARMAZENAMENTO:
- Sessão do WhatsApp: /data/cogb-ai-auth (volume persistente da Deplexo)
- Dados do bot: /data/cogb-ai (volume persistente)
- Arquivos temporários de mídia: pasta temporária do sistema (/tmp), que pode ser apagada ao reiniciar

Os arquivos estado.js, pokemon.js, rpg.js e tops.js foram adaptados para gravar em /data.
Se existirem arquivos antigos em seus caminhos anteriores, o projeto tenta copiá-los
para /data na primeira inicialização, sem sobrescrever arquivos persistentes existentes.

CONFIGURAÇÃO:
1. Envie esta pasta do projeto para um repositório GitHub privado.
2. Conecte o repositório à Deplexo.
3. Crie o aplicativo como Worker (não Web).
4. Mantenha o Dockerfile como método de build.
5. Configure no painel as variáveis que o bot já utiliza, como ADMIN_NUMBER,
   BOT_NUMBER e as chaves de API necessárias. Não coloque segredos no GitHub.
6. Faça o primeiro deploy e confira os logs.

OBSERVAÇÕES IMPORTANTES:
- O plano gratuito informado pela Deplexo tem 128 MB de RAM. O limite de heap do Node
  não limita toda a memória do processo; Baileys, buffers, bibliotecas nativas e FFmpeg
  também consomem RAM. Portanto, não há garantia de que o COGB-AI completo ficará abaixo
  do limite em todos os usos, principalmente ao processar mídias grandes.
- Os arquivos em /tmp são temporários. A sessão e os dados importantes devem ficar em /data.
- Um Worker não precisa do servidor HTTP de health check; por isso ele foi removido desta versão.
- Não gere códigos de pareamento repetidamente. Aguarde os logs e investigue a causa antes
  de reiniciar várias vezes.

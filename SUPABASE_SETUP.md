# Ativação do Supabase

## 1. Criar a tabela segura

1. Abra o projeto `lemhsftovgkmsdajszpn` no Supabase.
2. Entre em **SQL Editor**.
3. Clique em **New query**.
4. Copie todo o conteúdo de `supabase-schema.sql`.
5. Cole no editor e clique em **Run**.

O script cria a tabela `finance_app_state`, ativa Row Level Security e permite que cada usuário acesse somente os próprios dados.

## 2. Conferir a autenticação

Em **Authentication > Providers**, mantenha o provedor **Email** habilitado.

Se a confirmação de e-mail estiver habilitada, depois de criar a conta será necessário abrir a mensagem enviada pelo Supabase. Após confirmar, abra novamente o aplicativo e entre com e-mail e senha.

## 3. Primeiro acesso e migração

1. Abra `index.html`.
2. Clique em **Criar conta**.
3. Confirme o e-mail, se solicitado.
4. Entre com a conta criada.

Se já houver dados da versão anterior no navegador, eles serão enviados automaticamente ao Supabase no primeiro acesso. Depois disso, o Supabase passa a ser a fonte principal.

## Segurança

O arquivo `supabase-config.js` contém somente a chave pública do projeto. Nunca coloque uma chave `secret` ou `service_role` nos arquivos do aplicativo.

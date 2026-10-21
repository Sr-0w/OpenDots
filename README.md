# OpenDots

**Des compagnons IA autonomes, collaboratifs et proactifs — qui se configurent en leur parlant.**

OpenDots donne à chacun une petite équipe de compagnons numériques persistants. Chaque compagnon a une identité, une conversation principale permanente, une mémoire à long terme, des responsabilités, des outils et des activités autonomes (planifications, surveillances, webhooks) qui continuent de tourner quand l'interface est fermée.

> Statut : fondations fonctionnelles (phases 1 à 4 de la feuille de route, partiellement 3). Voir [Feuille de route](#feuille-de-route).

## Démarrage

Prérequis : Node.js ≥ 22 et pnpm.

```bash
pnpm install
pnpm dev          # moteur sur :4317 + interface sur http://127.0.0.1:5173
```

En production (un seul processus, interface servie par le moteur) :

```bash
pnpm build
pnpm start        # http://127.0.0.1:4317
```

Au premier lancement, OpenDots demande uniquement :

1. une **clé OpenRouter** (chiffrée localement) ;
2. un **modèle par défaut**.

Ensuite, tout se fait en discutant : « Salut ! », « Appelle-toi Ari », « Crée Venty pour mes recherches d'emploi », « Tous les matins à 8 h, fais-moi un point », « Souviens-toi que je préfère des réponses courtes », « Préviens-moi si cette page change »…

Aucune base de données à installer : OpenDots embarque PostgreSQL (PGlite) dans `./data`. Pour un PostgreSQL externe, définir `DATABASE_URL`. Les autres réglages facultatifs sont listés dans [`.env.example`](.env.example).

## Ce qui fonctionne

| Domaine | Fonctionnalités |
|---|---|
| **Onboarding** | Clé OpenRouter validée et chiffrée (AES-256-GCM), choix du modèle, premier compagnon prêt immédiatement |
| **Conversation-first** | Le compagnon modifie réellement sa configuration via des outils structurés : nom, personnalité, consignes, modèle, permissions |
| **Conversations** | Une conversation permanente par compagnon, streaming, Markdown, raisonnement, appels d'outils lisibles, reprise du flux après rechargement |
| **Équipe** | Création de compagnons en langage naturel, messagerie interne asynchrone, délégation avec réveil sur réponse, fils entre compagnons consultables |
| **Moteur de vie** | Planifications (unique, intervalle, cron avec fuseau), surveillances de pages **sans LLM** (changement, présence/absence de texte, regex), webhooks entrants dédupliqués, réveils autonomes, messages proactifs ou `<silence/>` |
| **Exécution durable** | File de tâches PostgreSQL : reprise après crash, relances avec délai croissant, déduplication, rattrapage unique des échéances manquées, limite de profondeur des chaînes de collaboration |
| **Approbations** | Les actions sensibles sont *préparées*, puis exécutées par le backend après validation (carte ou réponse en conversation) ; états préparé / approuvé / exécuté / échoué distincts |
| **Mémoire** | Souvenirs privés ou partagés, recherche plein texte, sélection contextuelle, correction et oubli par conversation |
| **Modèles** | OpenRouter (raisonnement, fournisseur préféré), Ollama local ou réseau, modèle par compagnon ou par défaut |
| **Sécurité** | Secrets hors base et jamais envoyés au modèle ; outils de configuration indisponibles lors des réveils autonomes ; contenus externes marqués non fiables ; protection SSRF ; extension de permissions soumise à validation ; journal des opérations |
| **Mail** | Comptes IMAP/SMTP (préréglages Gmail, Outlook, iCloud…), relève périodique, règles « à la réception d'un e-mail » filtrées par expéditeur/objet, recherche et lecture, brouillons présentés dans une carte « Prêt à envoyer » (Envoyer / Modifier / Abandonner) |
| **Skills** | Savoir-faire partagés par tous les compagnons, chargés à la demande ; créés depuis la page Skills ou en disant « enregistre ça comme skill » |
| **Connecteurs MCP** | Serveurs HTTP, SSE ou locaux (stdio), secrets chiffrés, validation à chaque appel ou exécution directe, serveurs en panne isolés |
| **Plugins** | Paquets de skills et de connecteurs décrits par un manifeste JSON (URL ou collé), aperçu avant installation — voir [`examples/plugin-redaction.json`](examples/plugin-redaction.json) |
| **Interactions** | Formulaires dans la conversation (texte, choix unique, choix multiples, confirmation, nombre, date), demandes de connexion avec bouton vers une modale sécurisée, cartes « tâche créée » |
| **Tâches planifiées** | Page dédiée : toutes les routines, surveillances, règles mail et webhooks, avec pause/reprise, édition manuelle (répétition, jours, heure, cron, conditions), exécution immédiate |
| **Interface** | React, shadcn/ui, AI Elements, AI SDK ; liste des compagnons, panneau Activités / Mémoire / Journal / Profil, validations, notifications du navigateur, paramètres minimaux, thème sombre, mobile |

## Architecture

```
apps/
  server/   Moteur TypeScript (Hono, AI SDK, Drizzle, PGlite/PostgreSQL)
    src/agents/       Agent Core : tours, prompt, outils, flux reprenables
    src/life/         Event Engine + Scheduler (planifications, surveillances, webhooks)
    src/jobs/         Workflow Engine : file de tâches durable
    src/team/         Messaging Service entre compagnons
    src/approvals/    Permission Engine : validations humaines
    src/memory/       Memory Service
    src/mail/         Mail Service (IMAP, SMTP, brouillons, relève)
    src/connectors/   Connecteurs MCP et plugins
    src/skills/       Skills partagés
    src/requests/     Formulaires adressés à l'utilisateur
    src/models/       Model Gateway (OpenRouter, Ollama)
    src/api/          API REST + SSE temps réel + webhooks
  web/      Interface React (Vite, Tailwind, shadcn/ui, AI Elements)
packages/
  shared/   Contrats de données partagés
```

Le frontend ne contient aucune logique d'exécution : il peut être fermé sans arrêter les compagnons. Chaque tour de compagnon s'exécute côté serveur, est diffusé dans un flux que n'importe quel client peut rejoindre, et est persisté à la fin.

Les compagnons ne « réfléchissent » pas en permanence : un service léger surveille le temps et les événements, et ne sollicite le LLM que lorsque c'est nécessaire.

## Développement

```bash
pnpm typecheck
pnpm test                         # tests du moteur (PGlite en mémoire)
pnpm --filter @opendots/server db:generate   # après modification de src/db/schema.ts
```

Derrière un proxy HTTP(S), les variables `HTTPS_PROXY` / `NO_PROXY` sont respectées.

Pour essayer les connecteurs sans service externe :

- un serveur MCP de démonstration : commande `node`, arguments `--import <chemin>/apps/server/node_modules/tsx/dist/loader.mjs <chemin>/apps/server/test/fixtures/mcp-server.ts` ;
- une boîte mail locale : `node apps/server/node_modules/hoodiecrow-imap/bin/hoodiecrow.js --port=1143 --smtpPort=1025` (identifiant `testuser`, mot de passe `testpass`, SSL désactivé), avec `OPENDOTS_MAIL_INSECURE_TLS=1` pour accepter son certificat de test.

## Feuille de route

- [x] **Phase 1** — Fondations conversationnelles
- [x] **Phase 2** — Mémoire, outils, permissions, Ollama (recherche sémantique à venir)
- [x] **Phase 3** — Autonomie : planifications, surveillances, webhooks, service mail IMAP/SMTP, approbations, reprise (Gmail API / Microsoft Graph natifs à venir)
- [x] **Phase 4** — Collaboration multi-agents (partage de fichiers à venir)
- [ ] **Phase 5** — Ordinateur Linux partagé (VM, navigateur, computer use)
- [ ] **Phase 6** — Distribution desktop Tauri, notifications natives, sauvegarde
- [ ] **Phase 7** — Mascottes 3D (Three.js / React Three Fiber) synchronisées avec les états réels

Inspirations : Grok Bot, OpenAI Dots, Meta Muse.

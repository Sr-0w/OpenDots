# Déploiement Docker Compose et computer use

Le fichier [`compose.yml`](../compose.yml) cible **Linux, Docker Engine et Compose
2.24 ou plus récent**. Il ne nécessite ni compte de recherche ni API payante.
Chaque utilisateur d’OpenDots fournit toujours sa propre clé OpenRouter ; les
appels du modèle restent facturés par son fournisseur.

## Démarrage sur un serveur

```sh
git clone https://github.com/Sr-0w/OpenDots.git
cd OpenDots
cp deploy/compose.env.example .env
# Adapter OPENDOTS_PUBLIC_URL et OPENDOTS_DOMAIN dans .env.
docker compose up -d --build --wait
docker compose ps -a
```

Pour un essai local, définir `OPENDOTS_PUBLIC_URL=http://127.0.0.1:3000`.
Ouvrir cette même adresse. Pour un domaine public, activer HTTPS comme ci-dessous.
Le premier build télécharge Node, Debian, Chromium/XFCE et les dépendances ; il
peut prendre plusieurs minutes. Les prochains builds utilisent le cache Docker.

L’interface nécessite inscription/connexion puis une clé OpenRouter personnelle.
Après le choix du modèle, le premier compagnon engage lui-même la conversation.
Son accueil est une tâche persistante, reprise après redémarrage et protégée
contre les doublons ; aucun message utilisateur ni prompt suggéré n’est nécessaire.
Ouvrir **Ordinateur → Démarrer le bureau**, activer l’accès au bureau pour le
compagnon voulu et choisir un modèle avec images et outils. Les actions sont
autorisées directement par défaut ; le panneau permet de demander une validation
pour tout ou pour certains types d’actions, par compagnon.
**Prendre la main** suspend captures et actions
des modèles pour saisir soi-même les identifiants dans le navigateur distant.
Le bureau s’ouvre sur XFCE, sans lancer Chromium. L’agent ou l’utilisateur ouvre
le navigateur ou une autre application quand il en a besoin.

Pour promouvoir un compte déjà inscrit, arrêter l’application pendant l’accès
hors ligne au registre PGlite (ne pas ouvrir la même base depuis deux processus) :

```sh
docker compose stop app
docker compose run --rm --no-deps app node --import tsx scripts/auth-admin.ts toi@example.com
docker compose up -d app
```

L’administrateur configure une fois les applications OAuth Google/Microsoft/GitHub,
dans l’interface ou `.env` ; les utilisateurs se connectent ensuite chez leur
fournisseur. Voir [les instructions OAuth](accounts-and-connectors.md).

## Quels conteneurs sont lancés ?

| Élément | Rôle et cycle de vie | Accès / persistance |
| --- | --- | --- |
| `app` | Serveur Node, interface, authentification, bases par compte, courtier Git | HTTP sur `127.0.0.1:3000`, données dans le bind mount |
| `search-init` | Génère la configuration et un secret aléatoire, puis termine | Volume `search-config`, secret réutilisé aux redémarrages |
| `searxng` | Moteur OSS local, interroge DuckDuckGo/Brave/Wikipedia | JSON sur `127.0.0.1:18080`, jamais public |
| `computer-image` | Construit `opendots/computer:6`, puis termine avec succès | Prépare ensemble shell et bureaux |
| `*-computer-*` | Un conteneur **par compte**, créé à la demande, mis en pause après inactivité | Un UID, écran, presse-papiers, home et profil Chromium par bot ; aucun port VNC publié |
| `caddy` (profil `https`) | Reverse proxy et certificats automatiques | Ports 80/443 ; volumes de certificats persistants |

Ces ordinateurs sont des **conteneurs Linux**, pas des machines virtuelles avec
leur propre noyau. Chaque bot a son propre bureau et ses sessions, y compris entre bots du même compte.
Seul le dossier `/workspaces/shared` permet de partager volontairement des fichiers. Le courtier Git authentifié
s’exécute dans `app` depuis un dépôt temporaire propre ; aucun jeton OAuth n’est
transmis aux ordinateurs des compagnons.

Les builders terminés avec `Exited (0)` sont normaux. Les ordinateurs dynamiques
sont des conteneurs frères, **pas des services fixes de Compose**. Ils survivent à
un redémarrage de `app` et à `docker compose down`. Voir l’arrêt complet ci-dessous.

## Réseau, chemins et SELinux

`app` utilise `network_mode: host` et écoute uniquement sur `127.0.0.1` pour le proxy.
Le relais noVNC passe par `docker exec` vers le loopback interne du conteneur,
avec un mot de passe privé par bot ; aucun port VNC n’est publié sur l’hôte.
C’est un choix de déploiement Linux, pas une recette Docker Desktop Windows/macOS.
Ne remplacer ni ce mode par bridge, ni les ports VNC par `0.0.0.0`.

`OPENDOTS_DATA_DIR` doit être un **chemin absolu identique sur l’hôte et dans app**,
par défaut `/var/lib/opendots`. Le démon Docker de l’hôte résout les bind mounts
des enfants ; un montage `/chemin/hôte:/data` rendrait ces chemins incorrects.
Les comptes/bases, clés de chiffrement, pièces jointes, captures, workspaces et
profils Chromium résident tous sous ce dossier. Ne monter jamais ce dossier
entier dans un ordinateur ; l’application monte seulement son sous-dossier privé.

`app` monte le socket Docker et a donc un contrôle de niveau administrateur sur
l’hôte. C’est le contrôleur de confiance, pas une sandbox pour du code tiers.
Les bureaux et shells n’ont **pas** ce socket. Pour un service multi-utilisateur
non fiable, utiliser une VM/hôte dédié et fermer les inscriptions après création
des comptes (`OPENDOTS_REGISTRATION=closed`). Ne jamais exposer le socket Docker
sur TCP, ni publier les ports 5900 des bureaux.

Sur Fedora/SELinux, les homes/workspaces ont un label privé `:Z`, les certificats
et configurations partagés utilisent `:z`. Le contrôleur utilise `label=disable`
pour gérer ces montages imbriqués ; les ordinateurs gardent leurs labels et
restrictions. Ne pas appliquer un `:Z` exclusif au dossier racine partagé avec
plusieurs conteneurs. Les upgrades recréent les ordinateurs dont l’image ou la
configuration a changé ; les fichiers de leur home/workspace persistent, les
paquets installés dans la couche système non. Utiliser une image shell personnalisée
si ces paquets doivent rester.

## HTTPS et reverse proxy

Sur srv03, conserver le reverse proxy existant et le faire pointer sur
`http://127.0.0.1:3000`. Pour `opendots.snyders.xyz`, le DNS A pointe sur
`83.228.215.124` (sans protocole ni port). `OPENDOTS_PUBLIC_URL` doit correspondre
exactement à l’origine HTTPS utilisée par le navigateur et les callbacks OAuth.
Ne pas lancer deux instances de proxy en concurrence sur les ports 80/443.

Si aucun proxy n’est déjà installé, configurer le domaine dans `.env`, ouvrir
80/443 sur le pare-feu et activer le profil fourni :

```sh
docker compose --profile https up -d --build --wait
```

[`deploy/Caddyfile`](../deploy/Caddyfile) prend en charge WebSocket/noVNC et SSE.
Pour nginx existant, ajouter au vhost TLS :

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

Ne pas désactiver les contrôles Origin/cookies pour réparer noVNC. Le serveur
refuse l’origine incorrecte et coupe les WebSockets à la déconnexion/expiration.

## Ressources et fond d’écran

Prévoir environ **8 Go de RAM pour un petit déploiement avec un bureau actif**,
plus de l’espace disque pour les images et profils Chromium. Les plafonds ne
réservent pas la RAM : app 2 Go, SearXNG 1 Go, chaque compte 4 Go partagés par ses shells et bureaux. Les builders ne restent pas actifs. Adapter les variables `*_MEMORY` dans
[l’exemple](../deploy/compose.env.example) au nombre de comptes simultanés.
Les plafonds CPU sont de 2 cœurs pour app et chaque compte, et 1 pour SearXNG ;
`OPENDOTS_APP_CPUS`, `OPENDOTS_COMPUTER_CPUS` et `OPENDOTS_COMPUTER_PIDS` les règlent.
`OPENDOTS_COMPUTER_IDLE_SECONDS=300` met un compte inactif en pause et permet de
reprendre ses sessions en mémoire, sans relancer Chromium. Une vue noVNC ouverte
ou une commande active empêchent la pause. La pause conserve la RAM ; un premier
démarrage à froid et une compilation d’image prennent plus longtemps.

Les cinq images fournies sont incluses dans l’image du bureau. Le fond passe
progressivement de nuit à aube, matin, jour et crépuscule, selon le fuseau du
compte. Le calcul est local, toutes les minutes, sans téléchargement/API ; seuls
deux PNG de cache sont conservés. `OPENDOTS_DESKTOP_WALLPAPER=off` permet de garder
un fond choisi manuellement. Voir [computer use](computer-use.md#dynamic-wallpaper).

## Mise à jour et arrêt complet

Arrêter d’abord le serveur (aucun client ne pourra relancer un ordinateur), puis
ses ordinateurs dynamiques avec l’outil qui filtre les labels par dossier de
déploiement, sans ouvrir les bases :

```sh
docker compose stop app
docker compose run --rm --no-deps app node /app/deploy/stop-computers.mjs
git pull --ff-only
docker compose build --pull
docker compose up -d --wait --remove-orphans
```

Pour arrêter le déploiement entier, exécuter les deux premières commandes puis
`docker compose --profile https down`. Ne pas ajouter `-v` : cela supprime les
volumes Compose. Les conteneurs d’ordinateurs arrêtés restent disponibles ; ils
seront repris/recréés à leur prochaine utilisation. Ne pas utiliser un `docker
system prune` global sur un serveur hébergeant d’autres applications.

Avant une migration depuis l’installation Node de srv03, arrêter l’ancien service
et ses ordinateurs puis définir **le dossier data existant** comme chemin absolu
dans `.env`. Ne pas démarrer deux serveurs sur les mêmes bases. La copie du
dossier avec ses clés de chiffrement conserve comptes, connecteurs et historiques.

## Sauvegarde et restauration

Après arrêt de `app` et de ses ordinateurs comme ci-dessus :

```sh
docker compose run --rm --no-deps -T app sh -c 'tar -C "$OPENDOTS_DATA_DIR" -czf - .' > opendots-data.tgz
docker compose up -d app
```

Sauvegarder également `.env` séparément dans un stockage chiffré ; les profils,
captures et clés du dossier data sont sensibles même si les jetons en base sont
chiffrés. Conserver le fichier `secret.key` de chaque compte et toute clé
`OPENDOTS_SECRET_KEY` personnalisée. Le volume SearXNG ne contient pas les comptes
OpenDots ; il peut être régénéré. Les volumes Caddy conservent ses certificats.

Pour restaurer : arrêter l’installation, extraire l’archive dans le chemin
`OPENDOTS_DATA_DIR` vide avec les permissions/propriétaires conservés, restaurer
`.env`, puis `docker compose up -d --build --wait`. Ne pas ouvrir les inscriptions
ou remplacer les clés pour contourner une restauration incomplète.

## Contrôles et dépannage

```sh
docker compose config --quiet
docker compose ps -a
docker compose logs --tail 100 app searxng search-init
curl --fail http://127.0.0.1:3000/healthz
docker compose exec app docker info --format '{{.ServerVersion}}'
docker ps --filter label=opendots.workspaces
```

- **App unhealthy** : vérifier port occupé, permissions du dossier data, espace
  disque et logs. `/healthz` expose seulement `{"ok":true}`, sans comptes/secrets.
- **Le bureau ne démarre pas** : vérifier le builder `computer-image` (exit 0),
  les logs du conteneur graphique, le réseau du compte, sa limite mémoire et les
  montages absolus. Le premier navigateur peut prendre quelques secondes.
- **noVNC déconnecté** : vérifier HTTPS/public URL, cookies et Upgrade du proxy.
- **SearXNG unhealthy** : vérifier la génération du JSON, `/healthz`, les DNS et
  l’accès HTTPS sortant. Le mode automatique utilise `OPENDOTS_SEARXNG_URL` dans
  Compose ; il ne crée pas un deuxième moteur géré par l’application.
- **Proxy d’entreprise** : conserver les variables proxy et fournir un bundle CA
  public combiné via `OPENDOTS_CA_FILE` pour les builds. Le runtime doit aussi
  monter ses certificats et transmettre ses variables proxy. Le fichier
  [`deploy/compose.proxy.example.yml`](../deploy/compose.proxy.example.yml) fournit
  la surcharge : définir aussi `OPENDOTS_EXTRA_CA_FILE` (certificat CA public PEM
  additionnel), `HTTP_PROXY` et `HTTPS_PROXY`, puis ajouter
  `-f compose.yml -f deploy/compose.proxy.example.yml` à **toutes** les commandes
  Compose. Le certificat supplémentaire est transmis aux profils Chromium privés.
  Ne jamais désactiver la validation TLS.

Les tests reproductibles (sans compte externe ni appel de modèle payant) sont
`pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm test:computer:live`,
`pnpm test:images:ui` et `pnpm test:ui`. Les recherches publiques réelles sont
testées séparément par `pnpm test:search:live`.

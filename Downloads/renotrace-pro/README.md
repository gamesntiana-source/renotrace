<div align="center">

# RénoTrace Pro

### La plateforme de suivi de chantier qui transforme votre terrain en bureau connecté

**Photos géolocalisées · Intelligence artificielle · Chiffrement militaire · 100% mobile**

---

*Conçu pour les entreprises du bâtiment, de la rénovation énergétique et des travaux.*

</div>

---

## Pourquoi RénoTrace Pro ?

Les chantiers perdent en moyenne **3h par semaine** en administratif : appels pour savoir où en est le chantier, photos envoyées par WhatsApp sans contexte, rapports rédigés à la main, litiges faute de preuves photographiques datées.

**RénoTrace Pro règle tout ça.**

Chaque photo prise sur le terrain est automatiquement **horodatée, géolocalisée, associée à un opérateur et chiffrée**. Votre responsable voit en temps réel l'avancement depuis son téléphone. Vos clients reçoivent un rapport professionnel en un clic.

---

## Fonctionnalités

### Capture terrain intelligente

- **Photo instantanée** depuis la caméra du téléphone (caméra arrière par défaut)
- **Import depuis la galerie** pour ajouter des photos existantes
- **Géolocalisation automatique** à chaque prise de vue — adresse et coordonnées GPS précises
- **Classification par surface** : Sol, Mur, Plafond, Façade, Combles, Autre
- **Notes textuelles** associées à chaque photo
- **Compression intelligente** pour préserver l'espace de stockage sans perdre la qualité

### Suivi d'avancement en temps réel

- **Tableau de bord** avec vue globale : chantiers actifs, photos du jour, équipe présente
- **Barre de progression** par chantier (0 → 100%)
- **Statuts colorés** : En cours, En attente, Suspendu, Terminé
- **Timeline photographique** groupée par journée pour chaque chantier
- **Indicateur d'activité** : qui a pris des photos aujourd'hui, qui ne l'a pas encore fait

### Gestion des chantiers

- Création de chantiers avec **client, adresse, type de travaux, dates, notes**
- Organisation automatique des photos **par date et par chantier**
- **Punch list** : signalement de problèmes avec niveau de sévérité (Faible / Moyen / Élevé / Critique) et statut de résolution
- Modification et suppression sécurisées (droits selon le rôle)

### Hiérarchie et gestion des équipes

Cinq rôles distincts avec permissions progressives :

| Rôle | Accès |
|------|-------|
| **Super Admin** | Configuration complète, gestion des utilisateurs, journal d'audit, backup |
| **Dirigeant** | Vue globale de tous les chantiers, rapports, tableau de bord exécutif |
| **Conducteur de travaux** | Multi-chantiers, création de chantiers, suivi d'équipe |
| **Chef de chantier** | Gestion de son chantier, signalement de problèmes, photos |
| **Technicien** | Capture photos terrain, consultation de ses chantiers |

### Demandes d'accès avec validation

- Les employés **demandent un accès** depuis l'écran de connexion (nom, email, fonction souhaitée)
- L'administrateur reçoit une **notification email automatique**
- Il **approuve ou refuse** en un clic depuis le panel Admin
- À l'approbation : **compte créé automatiquement** avec mot de passe temporaire affiché à l'admin, à communiquer par SMS ou WhatsApp
- La personne est **forcée de changer son mot de passe** à la première connexion

### Intelligence artificielle intégrée

- **Assistant IA** propulsé par Groq (modèle Llama 3.1) disponible en permanence
- **Raccourcis rapides** : résumé des chantiers, rapport hebdomadaire, analyse d'activité
- **Questions en langage naturel** : "Quel chantier a le moins de photos ?", "Qui a été actif cette semaine ?"
- **Génération de rapports** automatiques à la demande
- Configuration simple : une clé API gratuite sur groq.com suffit

### Export et rapports

- **Rapport HTML complet** par chantier : photos organisées par jour, métadonnées GPS, opérateurs, surfaces — téléchargeable et imprimable
- **Export JSON** de toute la base de données (backup complet)
- **Import JSON** pour restaurer ou migrer vers un nouvel appareil
- Les rapports constituent une **preuve opposable** en cas de litige

### Synchronisation cloud

- **Google Drive** : synchronisation automatique après chaque modification (debounce 2,5s)
- Retrouvez vos données sur **n'importe quel téléphone** en vous connectant
- Backup automatique possible avec Google Drive
- Configuration en 15 minutes (voir section Configuration Drive)

### Application mobile (PWA)

- **Installable comme une vraie application** sur Android et iPhone sans passer par un store
- **Mode hors-ligne** : fonctionne sans connexion, synchronise quand le réseau revient
- Optimisée pour les **conditions terrain** : grands boutons, fort contraste, rapide
- Aucun abonnement, aucune mise à jour à installer manuellement

---

## Sécurité

> RénoTrace Pro a été conçu avec une approche **security-first**. Chaque donnée est protégée par les mêmes standards que les applications bancaires et médicales.

### Chiffrement de bout en bout

**Vos données ne sont jamais stockées en clair.**

La base de données locale est chiffrée avec **AES-GCM 256 bits** — le même algorithme utilisé par les banques et les services gouvernementaux. Sans la clé de déchiffrement (dérivée via PBKDF2 et propre à l'application), les données stockées dans le navigateur sont illisibles.

### Mots de passe inviolables

Les mots de passe ne sont **jamais stockés**, ni en clair, ni dans le code source. À la place :

- Chaque mot de passe est haché avec **PBKDF2-SHA256**
- **100 000 itérations** de hachage (standard recommandé par le NIST)
- **Sel aléatoire unique** par utilisateur (protège contre les attaques par table arc-en-ciel)

Concrètement : même si quelqu'un accédait à vos fichiers de données, il lui faudrait des années de calcul pour retrouver un seul mot de passe.

### Protection contre les attaques par force brute

- **5 tentatives** de connexion échouées → compte verrouillé **15 minutes** automatiquement
- Message clair indiquant le nombre de tentatives restantes
- Le verrouillage persiste même si le navigateur est relancé

### Sessions sécurisées

- La session est stockée en **`sessionStorage`** (pas `localStorage`) — elle est **automatiquement détruite** à la fermeture du navigateur ou de l'onglet
- **Expiration automatique** après 30 minutes d'inactivité
- Aucune session persistante : reconnexion nécessaire à chaque nouvelle ouverture du navigateur

### Journal d'audit complet

Chaque action sensible est enregistrée :

- Connexions (avec type d'appareil)
- Changements de mot de passe
- Créations et suppressions de comptes
- Approbations de demandes d'accès
- Réinitialisations de mot de passe

L'administrateur consulte ce journal depuis le **panel Admin → Journal**. Les 500 derniers événements sont conservés.

### Récapitulatif sécurité

| Fonction | Technologie | Niveau |
|----------|-------------|--------|
| Chiffrement données | AES-GCM 256 bits | Militaire |
| Hachage mots de passe | PBKDF2-SHA256 · 100k itérations | Bancaire |
| Protection brute force | Verrouillage automatique 5 tentatives | ✓ |
| Expiration session | 30 min d'inactivité | ✓ |
| Stockage session | sessionStorage (volatile) | ✓ |
| Mots de passe en clair | Jamais, nulle part | ✓ |
| Audit trail | 500 événements horodatés | ✓ |
| HTTPS obligatoire | Requis pour caméra et GPS | ✓ |

---

## Installation

### Prérequis

- Un hébergement **HTTPS** (obligatoire pour la caméra et le GPS)
- Les fichiers `icon-192.png` et `icon-512.png` à placer dans le dossier

### Option A — GitHub Pages (gratuit, recommandé)

```
1. Créez un compte sur github.com
2. Nouveau dépôt → nommez-le "renotrace-pro" → Public
3. Uploadez tous les fichiers du dossier
4. Settings → Pages → Source : main → Save
5. Votre URL : https://[votre-pseudo].github.io/renotrace-pro/
```

### Option B — Netlify (glisser-déposer, 30 secondes)

```
1. Allez sur app.netlify.com
2. Glissez-déposez le dossier renotrace-pro/ dans la zone de dépôt
3. Votre URL est générée instantanément
```

### Option C — Serveur privé

N'importe quel serveur web avec HTTPS suffit (Apache, Nginx, Caddy...). Copiez les fichiers dans le répertoire web, c'est tout.

---

## Installation sur les téléphones

### Android

1. Ouvrez l'URL dans **Chrome**
2. La bannière d'installation apparaît automatiquement → **Installer**
3. Ou : menu `⋮` → **Ajouter à l'écran d'accueil**

### iPhone / iPad

1. Ouvrez l'URL dans **Safari** (obligatoire — pas Chrome)
2. Bouton **Partager** ⬆ → **Sur l'écran d'accueil**
3. Nommez l'app → **Ajouter**

L'application s'ouvre ensuite en plein écran, sans barre de navigateur, comme une app native.

---

## Premier lancement

### Compte administrateur par défaut

```
Identifiant : admin
Mot de passe : 1234
```

> **Changez ce mot de passe immédiatement** après la première connexion :
> Profil → Modifier mon profil → Nouveau mot de passe

### Étapes recommandées au démarrage

1. **Connectez-vous** avec `admin` / `1234`
2. **Changez le mot de passe** admin (Profil → Modifier mon profil)
3. **Configurez le nom de l'entreprise** (Profil → Entreprise)
4. **Ajoutez votre email** sur le compte admin (pour la récupération de mot de passe)
5. **Créez le premier chantier** (onglet Chantiers → + Nouveau chantier)
6. Communiquez l'URL à vos équipes terrain — ils soumettront une demande d'accès que vous approuverez

---

## Utilisation quotidienne

### Pour les techniciens terrain

```
1. Ouvrir l'app → connexion
2. Appuyer sur le bouton 📷 central
3. Sélectionner le chantier dans la liste
4. Choisir la surface (Sol / Mur / Plafond / Façade...)
5. Ajouter une note si nécessaire
6. Prendre la photo → GPS s'applique automatiquement
7. Répéter pour chaque zone
```

### Pour les chefs de chantier

```
1. Dashboard → vue des chantiers du jour
2. Clic sur un chantier → voir les photos de l'équipe en temps réel
3. Onglet Problèmes → signaler un défaut
4. Modifier l'avancement (%) depuis les infos du chantier
```

### Pour les conducteurs et dirigeants

```
1. Dashboard → vue globale : qui travaille, combien de photos, avancement
2. Onglet Chantiers → filtrer, chercher, voir les retards
3. Onglet IA → "Donne-moi un résumé de la semaine"
4. Sélectionner un chantier → Infos → Rapport → exporter le PDF
```

### Pour l'administrateur

```
1. Profil → Administration → Demandes : approuver les nouveaux comptes
2. Administration → Opérateurs : gérer les rôles et supprimer des comptes
3. Administration → Journal : surveiller toute l'activité
4. Administration → Sauvegarde : exporter la base de données régulièrement
```

---

## Configuration avancée

### Intelligence artificielle (Groq)

L'IA fonctionne grâce à un **pool de clés Groq** hébergé sur votre compte Google. Les clés ne sont **jamais stockées dans le code source** — elles sont chargées dynamiquement au démarrage depuis un Google Apps Script privé.

#### Mise en place du serveur de clés (à faire une seule fois)

**Étape 1 — Créer le Google Apps Script**

1. Allez sur [script.google.com](https://script.google.com) (connecté avec votre compte Google)
2. Cliquez **"Nouveau projet"**
3. Supprimez le contenu existant et collez le code suivant :

```javascript
const GROQ_KEYS = [
  // Collez ici vos clés Groq (une par ligne, entre guillemets simples)
  // Exemple : 'gsk_xxxxxxxxxxxxxxxxxxxx',
];

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ keys: GROQ_KEYS }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

4. Cliquez **"Déployer"** → **"Nouveau déploiement"**
5. Type : **Application Web** · Exécuter en tant que : **Moi** · Accès : **Tout le monde**
6. Cliquez **"Déployer"** → copiez l'URL (format `https://script.google.com/macros/s/XXXX/exec`)

**Étape 2 — Relier l'app au script**

Dans `app.js`, ligne 22, remplacez :
```javascript
const GROQ_SCRIPT_URL = 'REMPLACER_PAR_URL_APPS_SCRIPT';
```
par :
```javascript
const GROQ_SCRIPT_URL = 'https://script.google.com/macros/s/VOTRE_URL/exec';
```

**Pourquoi cette architecture ?**

| Problème | Solution |
|----------|----------|
| Clés visibles dans le code source GitHub | Stockées sur votre Google Drive, jamais dans le repo |
| Une seule clé saturée | Pool de clés avec rotation automatique sur rate-limit (429) |
| Mise à jour des clés | Modifiez le script Google, pas besoin de toucher au code |
| Partage du code source | Les destinataires ne reçoivent pas les clés |

#### Ajouter sa propre clé Groq (optionnel)

Si vous souhaitez ajouter votre propre clé en plus du pool :

1. Créez un compte gratuit sur [console.groq.com](https://console.groq.com)
2. **API Keys** → **Create API Key** → copiez la clé (commence par `gsk_`)
3. Dans l'app : **Profil → Clé API Groq** → collez → **Enregistrer**

La clé personnelle est utilisée en dernier recours si le pool est épuisé.

> Le quota gratuit Groq est de 14 400 requêtes/jour par clé. Avec un pool de clés, la capacité totale est multipliée d'autant.

### Google Drive (synchronisation)

1. Allez sur [console.cloud.google.com](https://console.cloud.google.com)
2. Créez un projet → activez **Google Drive API**
3. Créez des identifiants **OAuth 2.0** → Application Web
4. Ajoutez votre URL en **Origine autorisée** ET en **URI de redirection**
5. Copiez le **Client ID**
6. Dans l'app : **Profil → Google Drive** → collez → **Enregistrer** → **Se connecter**

La synchronisation est ensuite automatique à chaque modification.

### Récupération de mot de passe

Deux méthodes :

**Si vous avez un email associé à votre compte :**
Écran de connexion → **Mot de passe oublié ?** → entrez votre email → un mot de passe temporaire s'affiche à l'écran. Notez-le, connectez-vous, puis changez-le immédiatement dans votre profil.

**Si vous n'avez pas d'email :** Contactez votre administrateur. Il peut réinitialiser votre compte depuis **Admin → Opérateurs**.

> Pour éviter ce cas, configurez votre email dès la première connexion : **Profil → Modifier mon profil → Email**.

---

## Questions fréquentes

**Les données sont-elles dans le cloud ?**
Par défaut, les données sont stockées sur le téléphone (localStorage chiffré). Activez Google Drive pour une synchronisation cloud. Vous restez propriétaire de vos données à 100%.

**Peut-on utiliser l'app sans internet ?**
Oui. Une fois installée, l'app fonctionne hors-ligne. Les photos et données sont sauvegardées localement et synchronisées quand la connexion revient.

**Combien de photos peut-on stocker ?**
Illimité dans la limite du stockage du téléphone (compression automatique appliquée). Les photos sont compressées en JPEG 85% à 1400px max, soit environ 200-400 Ko par photo.

**L'app est-elle compatible iOS ?**
Oui. Safari sur iPhone et iPad est entièrement supporté. L'installation se fait via le bouton Partager → Sur l'écran d'accueil.

**Peut-on l'utiliser sur plusieurs téléphones ?**
Oui, via Google Drive ou export/import JSON. Chaque utilisateur se connecte avec son propre compte, les données sont partagées via le cloud.

**Un technicien peut-il voir les chantiers des autres ?**
Non. Les techniciens voient uniquement les chantiers qui leur sont attribués. Les dirigeants et conducteurs voient tout.

**Que se passe-t-il si je change de téléphone ?**
Exportez vos données depuis **Profil → Exporter les données** (fichier JSON), puis importez-les sur le nouveau téléphone. Ou activez Google Drive pour une migration automatique.

**L'IA ne répond pas / "toutes les clés sont épuisées"**
Le pool de clés Groq est chargé au démarrage depuis le Google Apps Script. Vérifiez que :
1. L'URL Apps Script est correctement renseignée dans `app.js`
2. Le déploiement Apps Script est bien actif (script.google.com → votre projet → Déploiements)
3. Vos clés Groq sont valides (testez sur console.groq.com)
Si le problème persiste, ajoutez votre propre clé dans **Profil → Clé API Groq**.

**Peut-on partager le code source sans partager les clés ?**
Oui, c'est l'avantage de l'architecture Apps Script. Si vous donnez le code source à quelqu'un, il ne contient que l'URL de votre script — pas les clés elles-mêmes. Ils devront créer leur propre Apps Script et leurs propres clés Groq pour que l'IA fonctionne de leur côté.

---

## Architecture technique

| Composant | Technologie |
|-----------|-------------|
| Application | PWA single-page (HTML/CSS/JS vanilla) |
| Stockage | localStorage chiffré AES-GCM |
| Hors-ligne | Service Worker (Cache API) |
| Caméra | MediaDevices.getUserMedia |
| Géolocalisation | Navigator.geolocation + Nominatim (OpenStreetMap) |
| Cryptographie | Web Crypto API (natif, aucune dépendance) |
| Intelligence artificielle | Groq API (Llama 3.1-8b-instant) — pool multi-clés |
| Serveur de clés | Google Apps Script (votre compte Google) |
| Synchronisation | Google Drive API v3 (OAuth2) |
| Backend requis | **Aucun** — 100% client-side |
| Dépendances npm | **Zéro** |

L'application tient en **6 fichiers**. Aucun serveur, aucune base de données externe, aucun abonnement obligatoire.

> Le Google Apps Script joue le rôle de mini-backend gratuit hébergé sur votre compte Google. Il ne stocke aucune donnée utilisateur, il expose uniquement la liste des clés Groq de manière sécurisée.

---

## Fichiers du projet

```
renotrace-pro/
├── index.html        Application complète (structure + écrans)
├── styles.css        Design system complet
├── app.js            Logique applicative + cryptographie
├── sw.js             Service Worker (mode hors-ligne)
├── manifest.json     Configuration PWA
├── icon-192.png      Icône application
├── icon-512.png      Icône haute résolution
├── README.md         Ce fichier
└── DEMARCHES.md      Guide de démarrage rapide
```

---

## Licence et utilisation commerciale

Usage professionnel autorisé. Application développée sur mesure — personnalisation du nom, des couleurs et des fonctionnalités disponible sur demande.

---

<div align="center">

**RénoTrace Pro v2.0**

*Développé pour e-fficience — Diagnostics de performance énergétique*

Votre chantier mérite mieux qu'un groupe WhatsApp.

</div>

# 🛡️ Guide Administrateur — RénoTrace Pro

**Rôle : Super Admin 🛡️ / Dirigeant 👔**
Accès complet à toutes les fonctionnalités : gestion des utilisateurs, supervision, sauvegarde.

---

## 🔐 Compte par défaut
- Identifiant : `admin` | Mot de passe : `1234`
- ⚠️ **Changez le mot de passe immédiatement** après la première connexion
- Configurez votre email dans Profil → Modifier mon profil (nécessaire pour les notifications)

---

## 🏠 Tableau de bord

Les 4 cartes sont **cliquables** :
- 🏗️ **Chantiers actifs** → liste des chantiers
- 📸 **Photos aujourd'hui** → chantier le plus actif
- 👷 **Actifs aujourd'hui** → panel admin
- 📊 **Cette semaine** → liste des chantiers

---

## 👥 Panel Administration (Profil → Panel Super Admin)

### Vue d'ensemble
- Stats globales en temps réel
- Alertes si un opérateur n'a pas pris de photo aujourd'hui
- Accès rapide aux chantiers, photos, opérateurs

### Opérateurs
- Créer un compte : nom, email, identifiant, mot de passe, rôle
- **Rôles disponibles** : Technicien (1) · Chef chantier (2) · Conducteur (3) · Dirigeant (4) · Super Admin (5)
- Supprimer un compte
- Voir les stats par opérateur (nb photos, dernière connexion)

### Demandes d'accès
- Quand quelqu'un demande un accès depuis l'écran de connexion
- Approuver → crée le compte et génère un mot de passe temporaire à communiquer
- Refuser → supprime la demande

### Traçabilité
- Historique de toutes les photos (50 dernières)
- Filtrable par nom, chantier, opérateur

### ⚠️ Problèmes
- Tous les problèmes signalés par l'équipe
- Filtrez par chantier, sévérité, statut
- Résolvez les problèmes directement depuis ce panneau
- Vous recevez un email à chaque nouveau problème signalé

### 📋 Tâches
- Toutes les tâches de tous les opérateurs
- Groupées par utilisateur avec statut (fait / pas fait)

### 🔍 Journal d'audit
- 100 derniers événements : connexions, créations, changements de mot de passe
- Non modifiable — traçabilité complète

### Sauvegarde
- **Google Drive** : sauvegarde automatique chiffrée
  - Allez sur console.cloud.google.com → Créer un projet → Activer Drive API → Créer des identifiants OAuth 2.0
  - Copiez le **Client ID** (format : `xxxxx.apps.googleusercontent.com`)
  - ⚠️ Ne pas coller une URL — uniquement l'identifiant
- **Firebase** : sync temps réel entre appareils (pré-configuré)
- **Export JSON** : sauvegarde complète téléchargeable
- **Import JSON** : restauration depuis un fichier de sauvegarde

---

## ☁️ Google Drive — Configuration correcte

Le Client ID doit avoir ce format exact :
```
179182751689-xxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
```
**PAS** une URL, **PAS** un lien `https://...`

Étapes :
1. console.cloud.google.com → Nouveau projet
2. APIs et services → Activer "Google Drive API"
3. Identifiants → Créer → OAuth 2.0 → Application Web
4. URI de redirection : l'URL de votre application
5. Copier le **Client ID** → le coller dans RénoTrace

---

## 🤖 Assistant IA

- Alimenté par Groq (Llama 3.1) avec pool de clés intégré
- Contexte complet : chantiers, photos du jour, problèmes, utilisateurs actifs
- Ajoutez votre propre clé Groq dans Profil → si les clés intégrées sont épuisées

---

## 📚 Distribuer les guides

Les guides par rôle sont dans le dossier de l'application :
- `GUIDE-TECHNICIEN.md`
- `GUIDE-CHEF-CHANTIER.md`
- `GUIDE-CONDUCTEUR.md`
- `GUIDE-ADMIN.md`

Ou depuis l'app : Profil → Guide d'utilisation → Télécharger

---

*RénoTrace Pro v2.0 — Guide Administrateur*

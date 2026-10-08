/**
 * Application d'un import (code collé, fichier, ou — plus tard — envoi de l'admin).
 *
 * Corrige les défauts de l'ancienne app :
 *  • B2 : le poids est FUSIONNÉ par date (les pesées existantes sont conservées) ;
 *  • B3 : un id d'exercice déjà utilisé est régénéré (plus de carnet partagé
 *         entre deux profils), et les charges importées suivent le nouvel id.
 */
import { uid } from '../lib/ids.js';
import { createProfile, mergeWeights, mergeLogs, setCounterBase, exerciseIdExists, updateGoals } from './repo.js';

import { T, locale } from '../lib/i18n.js';
const defaultName = () =>
  `Import ${new Date().toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}`;

/** Régénère les ids d'exercices en collision. Renvoie la table ancienId → nouvelId. */
function dedupeExerciseIds(workout) {
  const map = {};
  const seen = new Set();
  for (const s of workout.sessions) {
    for (const e of s.exercises) {
      if (exerciseIdExists(e.id) || seen.has(e.id)) {
        const fresh = uid('e');
        map[e.id] = fresh;
        e.id = fresh;
      }
      seen.add(e.id);
    }
  }
  return map;
}

/**
 * @param {object} bundle  résultat de parseImport().bundle
 * @param {{workout?:boolean, diet?:boolean, protocol?:boolean, all?:boolean,
 *          weights?:boolean, counter?:boolean, exlogs?:boolean}} pick
 * @returns {string[]} résumé de ce qui a été importé
 */
export function applyImport(bundle, pick) {
  const done = [];
  const name = bundle.name || defaultName();
  const idMap = {};

  for (const cat of ['workout', 'diet', 'protocol']) {
    if (!pick[cat] || !bundle[cat]) continue;
    const data = structuredClone(bundle[cat]);
    if (cat === 'workout') Object.assign(idMap, dedupeExerciseIds(data));
    createProfile(cat, name, data);
    done.push({ workout: 'Programme', diet: 'Diet', protocol: 'Protocole' }[cat]);
  }

  if (pick.all && bundle.all) {
    let n = 0;
    for (const cat of ['workout', 'diet', 'protocol']) {
      for (const p of bundle.all[cat] || []) {
        const data = structuredClone(p.data);
        if (cat === 'workout') Object.assign(idMap, dedupeExerciseIds(data));
        createProfile(cat, p.name, data);
        n += 1;
      }
    }
    if (n) done.push(T`${n} profil(s)`);
  }

  if (pick.exlogs && bundle.exlogs) {
    const remapped = {};
    for (const [eid, entries] of Object.entries(bundle.exlogs)) remapped[idMap[eid] || eid] = entries;
    const n = mergeLogs(remapped);
    done.push(T`${n} charge(s)`);
  }

  if (pick.weights && bundle.weights?.length) {
    const n = mergeWeights(bundle.weights);
    done.push(T`${n} pesée(s) ajoutée(s)`);
  }

  if (pick.counter && bundle.counterBase != null) {
    setCounterBase(bundle.counterBase);
    done.push('Compteur');
  }

  // Objectifs : ajoutés à ceux existants (même id = conservé), historique fusionné.
  if (pick.goals && bundle.goals?.items?.length) {
    updateGoals((g) => {
      const ids = new Set(g.items.map((x) => x.id));
      g.items.push(...bundle.goals.items.filter((x) => !ids.has(x.id)));
      for (const [k, v] of Object.entries(bundle.goals.done || {})) g.done[k] = { ...v, ...(g.done[k] || {}) };
    });
    done.push('Objectifs');
  }

  return done;
}

-- Couleurs d'avatars : passage des teintes pastel à des couleurs franches.
UPDATE "agents" SET "color" = CASE "color"
  WHEN '#7c9cff' THEN '#2563eb'
  WHEN '#ff9fb2' THEN '#e11d48'
  WHEN '#7fd6c2' THEN '#16a34a'
  WHEN '#ffc078' THEN '#ea580c'
  WHEN '#b49cff' THEN '#7c3aed'
  WHEN '#8fd3ff' THEN '#0891b2'
  WHEN '#f7a8e0' THEN '#db2777'
  WHEN '#a9dc76' THEN '#ca8a04'
  ELSE "color" END;

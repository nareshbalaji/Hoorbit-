// Skill/experience/location matching used across recruitment + dashboards tools.

export function skillMatchScore(devSkills, requiredSkills) {
  if (!requiredSkills || !requiredSkills.length) return 0;
  const have = new Set((devSkills || []).map((s) => s.toLowerCase()));
  const hit = requiredSkills.filter((s) => have.has(String(s).toLowerCase())).length;
  return Math.round((hit / requiredSkills.length) * 100);
}

// Weighted score used by get_match_score: 50% skills overlap, 30% experience
// sufficiency, 20% location/remote fit. Illustrative weighting, documented so
// callers can see exactly how the number was produced (not a black box).
export function weightedMatchScore(developer, project) {
  const skillsPct = skillMatchScore(developer.skills, project.skills_required);
  const skillsComponent = skillsPct * 0.5;

  const yearsRequired = project.years_experience_required || 5;
  const expRatio = Math.min(1, (developer.experience_years || 0) / yearsRequired);
  const expComponent = expRatio * 30;

  const remoteOk = /remote/i.test(project.location || "");
  const sameRegion = project.location && developer.location && project.location.toLowerCase().includes((developer.location.split(",").pop() || "").trim().toLowerCase());
  const locationComponent = remoteOk ? 20 : sameRegion ? 20 : 8;

  const total = Math.round(skillsComponent + expComponent + locationComponent);
  return {
    score: Math.min(100, total),
    breakdown: {
      skills_match_pct: skillsPct,
      skills_component: Math.round(skillsComponent),
      experience_component: Math.round(expComponent),
      location_component: Math.round(locationComponent),
    },
  };
}

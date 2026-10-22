// One line saying which copy of the composer is running, from the server's
// /api/version answer (see lib/version.js).
export function describeVersion(info) {
  const parts = [`Version ${info.version}`];
  if (info.commit) {
    parts.push(info.branch ? `branch ${info.branch}` : 'no branch (detached)');
    parts.push(`commit ${info.commit}${info.date ? ` of ${info.date}` : ''}`);
    if (info.modified)
      parts.push('with uncommitted changes');
  } else {
    parts.push('not a git checkout');
  }
  if (info.folder)
    parts.push(`folder ${info.folder}`);
  return parts.join(' · ');
}

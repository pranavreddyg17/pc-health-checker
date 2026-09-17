// Public navigation paths through the console's primary sections and local tabs.
export async function navigate(page, destination) {
  if (destination === 'Overview')
    return page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Overview', exact: true })
      .click();
  if (destination === 'Settings')
    return page.getByRole('button', { name: 'Settings', exact: true }).click();
  const group = {
    'Reliability monitor': 'Reliability',
    'Repair workbench': 'Diagnostics',
    'Performance capture': 'Diagnostics',
    'Diagnostic tools': 'Diagnostics',
    Components: 'Hardware',
    'Replacement guide': 'Hardware',
    'Scan history': 'Records',
  }[destination];
  if (!group) throw Error(`Unknown navigation destination: ${destination}`);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: group, exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Section navigation' })
    .getByRole('button', { name: destination, exact: true })
    .click();
}

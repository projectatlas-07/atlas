const COMPLETE_READ_PAGE_SIZE = 500;

export async function readAllKeysetPages<Row extends { id: string }>(
  loadPage: (afterId: string | null, pageSize: number) => Promise<readonly Row[]>,
): Promise<Row[]> {
  const rows: Row[] = [];
  let afterId: string | null = null;

  while (true) {
    const page = await loadPage(afterId, COMPLETE_READ_PAGE_SIZE);
    if (page.length > COMPLETE_READ_PAGE_SIZE) {
      throw new Error("Paginated read returned more rows than requested.");
    }
    let previousId = afterId;
    for (const row of page) {
      if (!row.id || (previousId !== null && row.id <= previousId)) {
        throw new Error("Paginated read returned unstable row ordering.");
      }
      rows.push(row);
      previousId = row.id;
    }
    if (page.length < COMPLETE_READ_PAGE_SIZE) return rows;
    afterId = page[page.length - 1].id;
  }
}

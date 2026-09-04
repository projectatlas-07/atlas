export interface CompensationProvider {
  id: string;
  displayName: string;

  getPaidTotal(
    factoryId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<number>;
}

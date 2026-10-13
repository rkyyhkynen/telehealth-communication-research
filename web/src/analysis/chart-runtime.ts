import { Chart as ChartJS, type Chart } from 'chart.js/auto';
import 'chartjs-adapter-date-fns';
import ChartDataLabels from 'chartjs-plugin-datalabels';

let datalabelsRegistered = false;

if (!datalabelsRegistered) {
  ChartJS.register(ChartDataLabels);
  datalabelsRegistered = true;
}

export { ChartJS };
export type { Chart };

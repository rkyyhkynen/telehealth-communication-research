import { DataProcessor } from './dataProcessor';

export type LabeledInterpretation = {
  label: string;
  text: string;
};

function emotionInterpretation(emotion: string): string {
  switch (emotion.toLowerCase()) {
    case 'neutral':
      return 'You maintained neutral expression';
    case 'happy':
      return 'You were smiling';
    case 'sad':
      return 'Your lip corners were pulled down';
    case 'angry':
      return 'Your brows were lowered and drawn together';
    case 'surprise':
      return 'Your eyes were widened and brows raised';
    case 'fear':
      return 'Your eyes were widened and mouth slightly open';
    case 'disgust':
      return 'Your nose was wrinkled or upper lip raised';
    default:
      return `You displayed ${emotion.toLowerCase()}`;
  }
}

export function getExpressionInterpretations(): LabeledInterpretation[] {
  const emotions = DataProcessor.getEmotionPercentages();
  return Object.entries(emotions)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([emotion, percentage]) => ({
      label: `${emotion.charAt(0).toUpperCase() + emotion.slice(1)} (${Math.round(percentage)}%)`,
      text: emotionInterpretation(emotion)
    }));
}

export function getExpressionTimelineInterpretations(): string[] {
  return [
    'This timeline shows detected facial expressions over time. Variations are normal and expected.'
  ];
}

export function getGazeInterpretations(): string[] {
  return [
    'Looking away or down can be natural (e.g. taking notes)',
    'Solid blue blocks = a higher concentration of center-gaze periods'
  ];
}

export function getHeadPoseInterpretations(): string[] {
  return [
    'Looking away or down can be natural (e.g. taking notes)',
    'Solid blue blocks = a higher concentration of forward head-pose periods'
  ];
}

export function getShoulderInterpretations(): LabeledInterpretation[] {
  const shoulderData = DataProcessor.getShoulderVisibilityData();
  const visiblePercentage = shoulderData.visiblePercentage;

  let interpretation = '';
  if (visiblePercentage >= 80) {
    interpretation = 'Shoulders were visible on camera most of the time';
  } else if (visiblePercentage >= 50) {
    interpretation = 'Shoulders were visible on camera about half or more of the time';
  } else {
    interpretation = 'Shoulders were visible on camera less than half of the time';
  }

  return [
    {
      label: `Shoulders visible (${visiblePercentage.toFixed(0)}%)`,
      text: interpretation
    },
    {
      label: 'Note',
      text: 'Showing your shoulders helps convey more complete body language'
    }
  ];
}

export function getNoddingInterpretations(): LabeledInterpretation[] {
  const { nodCount, shakeCount } = DataProcessor.getNoddingShakingData();

  if (nodCount > 0 && shakeCount > 0) {
    return [{
      label: `Nodding (${nodCount}) and shaking (${shakeCount}) detected`,
      text: 'These events were identified from head movement analysis'
    }];
  }

  if (nodCount > 0) {
    return [{
      label: `Nodding detected (${nodCount})`,
      text: 'Events were identified from head movement analysis'
    }];
  }

  if (shakeCount > 0) {
    return [{
      label: `Shaking detected (${shakeCount})`,
      text: 'Events were identified from head movement analysis'
    }];
  }

  return [{
    label: 'No nodding or shaking detected',
    text: 'No nodding or shaking events were detected during this session'
  }];
}

export function getBrowInterpretations(): LabeledInterpretation[] {
  const browData = DataProcessor.getBrowData();
  const rows: LabeledInterpretation[] = [];
  const neutralPercentage = Number(browData.neutralPercentage);
  const activityPercentage = Number(browData.activityPercentage);

  if (neutralPercentage > 0) {
    rows.push({
      label: `Relaxed (${Math.round(neutralPercentage)}%)`,
      text: 'Brows were in a neutral position'
    });
  }

  if (activityPercentage > 0) {
    rows.push({
      label: `Raised/Lowered (${Math.round(activityPercentage)}%)`,
      text: 'Brow movement was detected'
    });
  }

  return rows;
}

export function getTranscriptInterpretations(): string[] {
  const audioResult = DataProcessor.getSpeechText();
  if (!audioResult) {
    return ['No speech was detected or the audio quality was insufficient for transcription'];
  }

  const rows = [
    'Review the transcript for recognition accuracy before interpreting language patterns',
    'Reducing filler words can improve clarity and confidence'
  ];

  const speakingTime = DataProcessor.getSpeakingTimePercentage();
  if (speakingTime !== null) {
    rows.push(`You spoke for approximately ${speakingTime}% of the call duration`);
    const markers = DataProcessor.getSpeechMarkers();
    if (typeof markers?.openEndedQuestionCount === 'number') {
      rows.push(`You asked ${markers.openEndedQuestionCount} open-ended questions during the call`);
    } else {
      rows.push('No open-ended questions were detected');
    }
  }

  return rows;
}

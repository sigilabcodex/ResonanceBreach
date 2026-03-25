export interface AudioBusLayout {
  music: GainNode;
  atmosphere: GainNode;
  rawEcology: GainNode;
  selectionUi: GainNode;
}

export const createAudioBusLayout = (context: AudioContext, master: GainNode): AudioBusLayout => {
  const music = context.createGain();
  const atmosphere = context.createGain();
  const rawEcology = context.createGain();
  const selectionUi = context.createGain();

  music.gain.value = 1;
  atmosphere.gain.value = 1;
  rawEcology.gain.value = 1;
  selectionUi.gain.value = 1;

  music.connect(master);
  atmosphere.connect(master);
  rawEcology.connect(master);
  selectionUi.connect(master);

  return {
    music,
    atmosphere,
    rawEcology,
    selectionUi,
  };
};

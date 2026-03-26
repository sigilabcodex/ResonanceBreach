export interface AudioBusLayout {
  music: GainNode;
  atmosphere: GainNode;
  rawEcology: GainNode;
  selectionUi: GainNode;
  musicControl: GainNode;
  atmosphereControl: GainNode;
  rawEcologyControl: GainNode;
  selectionUiControl: GainNode;
}

export const createAudioBusLayout = (context: AudioContext, master: GainNode): AudioBusLayout => {
  const music = context.createGain();
  const atmosphere = context.createGain();
  const rawEcology = context.createGain();
  const selectionUi = context.createGain();
  const musicControl = context.createGain();
  const atmosphereControl = context.createGain();
  const rawEcologyControl = context.createGain();
  const selectionUiControl = context.createGain();

  music.gain.value = 1;
  atmosphere.gain.value = 1;
  rawEcology.gain.value = 1;
  selectionUi.gain.value = 1;
  musicControl.gain.value = 1;
  atmosphereControl.gain.value = 1;
  rawEcologyControl.gain.value = 1;
  selectionUiControl.gain.value = 1;

  music.connect(musicControl);
  atmosphere.connect(atmosphereControl);
  rawEcology.connect(rawEcologyControl);
  selectionUi.connect(selectionUiControl);
  musicControl.connect(master);
  atmosphereControl.connect(master);
  rawEcologyControl.connect(master);
  selectionUiControl.connect(master);

  return {
    music,
    atmosphere,
    rawEcology,
    selectionUi,
    musicControl,
    atmosphereControl,
    rawEcologyControl,
    selectionUiControl,
  };
};

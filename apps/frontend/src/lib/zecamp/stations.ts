/**
 * zecAmp radio: public live streams, each checked on 2026-09-29 to answer over
 * HTTPS with CORS (so the EQ and visualiser work on them too).
 *
 * `hls` streams play through hls.js (lazy-loaded; Safari plays them natively).
 * `resolve` streams have no fixed URL; /api/radio/<id> finds the current one
 * when the station is tuned (KBS signs its links, WEFUNK rotates nodes).
 * `noCors` streams send no usable CORS header (WFMU allows one partner only):
 * they play untouched on a second element, so the EQ and visualiser rest.
 * StreamTheWorld and dispatcher URLs redirect to a rotating node or a token:
 * keep the redirecting URL here, never the final one.
 */

export interface Station {
  id: string;
  name: string;
  where: string;          // country, or the genre line under the name
  url: string;
  hls?: boolean;
  resolve?: 'kbs' | 'wefunk';
  noCors?: boolean;
}

export interface StationGroup { label: string; stations: Station[] }

const STW = (mount: string) => `https://playerservices.streamtheworld.com/api/livestream-redirect/${mount}`;

export const NEWS: StationGroup[] = [
  { label: 'North America', stations: [
    { id: 'cbc1', name: 'CBC Radio One', where: 'Canada', url: STW('CBLAFM_CBC.mp3') },
    { id: 'kqed', name: 'KQED', where: 'US', url: 'https://streams.kqed.org/kqedradio' },
    { id: 'wbur', name: 'WBUR', where: 'US', url: 'https://fm909.wbur.org/wbur_www' },
    { id: 'wnyc', name: 'WNYC', where: 'US', url: 'https://fm939.wnyc.org/wnycfm-web' },
    { id: 'cspan', name: 'C-SPAN Radio', where: 'US', url: STW('CSPANRADIO.mp3') },
  ] },
  { label: 'Europe', stations: [
    { id: 'bbcws', name: 'BBC World Service', where: 'UK', url: 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service' },
    { id: 'dw', name: 'Deutsche Welle (DW08)', where: 'Germany', url: 'https://dw.audiostream.io/dw/1027/mp3/64/dw08' },
    { id: 'rfi', name: 'RFI English', where: 'France', url: 'https://rfienanglais64k.ice.infomaniak.ch/rfienanglais-64.mp3' },
    { id: 'franceinfo', name: 'Franceinfo', where: 'France', url: 'https://icecast.radiofrance.fr/franceinfo-hifi.aac' },
    { id: 'rne5', name: 'RNE Radio 5', where: 'Spain', url: 'https://dispatcher.rndfnk.com/crtve/rne5/main/mp3/high' },
  ] },
  { label: 'Asia', stations: [
    { id: 'nhk', name: 'NHK World Radio Japan', where: 'Japan', url: 'https://nhkworld-radio.nhkworld.jp/hls/live/nhkworld-radio-media2/index.m3u8', hls: true },
    { id: 'air', name: 'All India Radio News', where: 'India', url: 'https://airhlspush.pc.cdn.bitgravity.com/httppush/hlspbaudio233/hlspbaudio233_Auto.m3u8', hls: true },
    { id: 'kbs', name: 'KBS World Radio', where: 'Korea', url: '', hls: true, resolve: 'kbs' },
    { id: 'cna938', name: 'CNA 938', where: 'Singapore', url: STW('938NOWAAC.aac') },
    { id: 'pbc', name: 'Radio Pakistan', where: 'Pakistan', url: 'https://whmsonic.radio.gov.pk:7005/stream' },
  ] },
  { label: 'Middle East / N. Africa', stations: [
    { id: 'aja', name: 'Al Jazeera Arabic', where: 'Qatar', url: 'https://live-hls-audio-web-aja.getaj.net/VOICE-AJA/index.m3u8', hls: true },
    { id: 'mcd', name: 'Monte Carlo Doualiya', where: 'France / Arabic', url: 'https://montecarlodoualiya128k.ice.infomaniak.ch/mc-doualiya.mp3' },
    { id: 'trt', name: 'Voice of Türkiye', where: 'Türkiye', url: 'https://radio-trtvotworld.medya.trt.com.tr/master.m3u8', hls: true },
    { id: 'kanbet', name: 'Kan Reshet Bet', where: 'Israel', url: STW('KAN_BET.mp3') },
  ] },
  { label: 'Sub-Saharan Africa', stations: [
    { id: 'safm', name: 'SAfm', where: 'South Africa', url: STW('SAFM.mp3') },
    { id: 'chafrica', name: 'Channel Africa', where: 'South Africa', url: `${STW('CA247.mp3')}?dist=sabc-web-app` },
    { id: 'kbc', name: 'KBC English Service', where: 'Kenya', url: 'https://stream.zeno.fm/mhmwnyyst5quv' },
    { id: 'gbc', name: 'GBC Uniiq FM', where: 'Ghana', url: 'https://mediagh.us:2000/stream/uniiqfm' },
    { id: 'frcn', name: 'Radio Nigeria Karama FM', where: 'Nigeria (Kaduna)', url: 'https://eu1.fastcast4u.com/proxy/frcnkarama?mp=/1' },
  ] },
  { label: 'Latin America', stations: [
    { id: 'rna', name: 'Radio Nacional Argentina', where: 'Argentina', url: 'https://sa.mp3.icecast.magma.edge-access.net/sc_rad1' },
    { id: 'cbn', name: 'CBN São Paulo', where: 'Brazil', url: STW('CBN_SPAAC.aac') },
    { id: 'ebc', name: 'Rádio Nacional', where: 'Brazil', url: 'https://radionacionalrio-stream.ebc.com.br/ebc/radionacionalriodejaneiro/playlist.m3u8', hls: true },
    { id: 'caracol', name: 'Caracol Radio', where: 'Colombia', url: STW('CARACOL_RADIOAAC.aac') },
    { id: 'cooperativa', name: 'Radio Cooperativa', where: 'Chile', url: 'https://unlimited3-cl.dps.live/cooperativafm/mp3/icecast.audio' },
  ] },
  { label: 'Oceania / Pacific', stations: [
    { id: 'abcnews', name: 'ABC NewsRadio', where: 'Australia', url: 'https://abc.streamguys1.com/live/newsradio/icecast.audio' },
    { id: 'abcrn', name: 'ABC Radio National', where: 'Australia', url: 'https://abc.streamguys1.com/live/rnnsw/icecast.audio' },
    { id: 'rnz', name: 'RNZ National', where: 'New Zealand', url: 'https://radionz.streamguys1.com/national/national/playlist.m3u8', hls: true },
    { id: 'rnzpac', name: 'RNZ Pacific', where: 'Pacific', url: 'https://radionz.streamguys1.com/pacific/pacific/playlist.m3u8', hls: true },
    { id: 'sbs1', name: 'SBS Radio 1', where: 'Australia', url: 'https://sbs-ice.streamguys1.com/sbs1-sbs-web' },
  ] },
];

export const MUSIC: StationGroup[] = [
  { label: 'Rock', stations: [
    { id: 'kexp', name: 'KEXP', where: 'Rock / indie / punk', url: 'https://kexp.streamguys1.com/kexp160.aac' },
    { id: 'delicious', name: 'Delicious Agony', where: 'Progressive / psych', url: 'https://deliciousagony.streamguys1.com/' },
  ] },
  { label: 'Hip-Hop & Phonk', stations: [
    { id: 'badradio', name: 'BADRADIO', where: 'Phonk / trap / chill', url: 'https://s2.radio.co/s2b2b68744/listen' },
    { id: 'phonkio', name: 'Phonkio Radio', where: 'Phonk', url: 'https://stream.phonkioradio.com/listen/phonkio_radio/radio.mp3' },
    { id: 'wefunk', name: 'WEFUNK Radio', where: 'Hip-hop / funk / soul', url: '', resolve: 'wefunk' },
    { id: 'chrome', name: 'Chrome Radio Live', where: 'Underground hip-hop', url: 'https://s3.voscast.com:11499/stream' },
  ] },
  { label: 'Drum & Bass', stations: [
    { id: 'dnbradio', name: 'DNBRADIO', where: 'Drum & bass / jungle', url: 'https://azura.drmnbss.org/listen/dnbradio/radio.mp3' },
    { id: 'edmdnb', name: 'DnB & EDM', where: 'Drum & bass / bass', url: 'https://edmdnb.com:448/radio/8000/radio.mp3' },
  ] },
  { label: 'Electronic', stations: [
    { id: 'megadance', name: 'MEGADANCE Radio', where: 'EDM / dance', url: 'https://1.airadiostream.com/megadance' },
    { id: '1mix-edm', name: '1Mix EDM', where: 'EDM / house', url: 'https://fr2.1mix.co.uk:8060/320h' },
    { id: '1mix-trance', name: '1Mix Trance', where: 'Trance', url: 'https://fr2.1mix.co.uk:8060/320' },
    { id: 'dirty1', name: 'dirty.radio ch1', where: 'Techno / electronic', url: 'https://live.dirty.radio/ch1/' },
    { id: 'dirty2', name: 'dirty.radio ch2', where: 'Electronic', url: 'https://live.dirty.radio/ch2/' },
  ] },
  { label: 'House & Deep', stations: [
    { id: 'ldnhouse', name: 'LDN House Radio', where: 'House / acid / techno', url: 'https://stream.ldnhouseradio.net/listen/live/radio.mp3' },
    { id: 'misto-juda', name: 'Misto FM Juda', where: 'Afro / deep house', url: 'https://stream.mistofm.com/listen/misto_fm_juda/radio.mp3' },
    { id: 'misto-deep', name: 'Misto FM Deep', where: 'Deep house / chill', url: 'https://stream.mistofm.com/listen/misto_fm_deep/radio.mp3' },
  ] },
  { label: 'Jazz & Swing', stations: [
    { id: 'jazzfm91', name: 'JAZZ.FM91', where: 'Jazz', url: 'https://jazzfm91.streamb.live/SB00009' },
    { id: 'electroswing', name: 'Electro Swing Radio', where: 'Electro swing', url: 'https://streamer.radio.co/s2c3cc784b/listen' },
  ] },
  { label: 'Freeform & Underground', stations: [
    { id: 'wfmu', name: 'WFMU Freeform', where: 'Freeform / experimental', url: 'https://stream0.wfmu.org/freeform-128k.mp3', noCors: true },
    { id: 'wfmu-drummer', name: 'WFMU Give the Drummer', where: 'Global obscura / free jazz', url: 'https://stream0.wfmu.org/drummer', noCors: true },
    { id: 'uncertain', name: 'UncertainFM', where: 'Indie / weird freeform', url: 'https://streaming.live365.com/a23389' },
    { id: 'shadypines', name: 'Shady Pines Radio', where: 'Outsider / ambient / eclectic', url: 'https://shady-pines-radio.radiocult.fm/stream' },
  ] },
  { label: 'Classical', stations: [
    { id: 'abiding', name: 'Abiding Radio Instrumental', where: 'Classical / instrumental', url: 'https://streams.abidingradio.com/instrumental' },
  ] },
];

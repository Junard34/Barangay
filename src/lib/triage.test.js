import { describe, it, expect } from 'vitest';
import { CATEGORY_GUIDANCE, CATEGORY_PRIORITY, CHANNELS, CHANNEL_ROLE_MAP, triageComplaint, detectLanguage } from './triageService.js';
import { TRIAGE_TRAINING_DATA } from './triageTrainingData.js';

const classificationExamples = [
  ['Safety Rules', 'The curfew is ignored by motorcycles riding through the streets at night.'],
  ['Safety Rules', 'May naglalakad pa rin sa labas kahit tapos na ang curfew.'],
  ['Safety Rules', 'Naa pay residente sa gawas bisan human na ang oras sa curfew.'],
  ['Damaged Infrastructures', 'The sidewalk is cracked and the public bridge is damaged.'],
  ['Damaged Infrastructures', 'May sira at bumigay na kanal sa kalsada kaya hindi makadaan ang mga tao.'],
  ['Damaged Infrastructures', 'Naay dakong lungag sa karsada ug nagtapok ang tubig.'],
  ['Medical Assistance', 'A man collapsed and needs urgent medical help because he cannot breathe.'],
  ['Medical Assistance', 'Nahilo at hinimatay ang aking lola at kailangan niya ng tulong medikal.'],
  ['Medical Assistance', 'Nagsakit ang iyang dughan ug nanginahanglan siya og tabang medikal.'],
  ['Noise Complaints', 'Loud construction work starts before dawn and keeps the neighborhood awake.'],
  ['Noise Complaints', 'Karaoke nang karaoke ang kapitbahay hanggang madaling-araw.'],
  ['Noise Complaints', 'Kusog kaayo ang sound system sa pista ug dili makapahuway ang mga bata.'],
  ['Drug Abuse', 'I saw a dealer distributing cocaine near the alley.'],
  ['Drug Abuse', 'May gumagamit ng shabu sa bakanteng bahay sa aming lugar.'],
  ['Drug Abuse', 'Adunay nagbaligya og marijuana sa gawas sa eskwelahan.'],
  ['Threats', 'He threatened to beat me if I reported him, but he never touched me.'],
  ['Threats', 'Nagbanta siyang sasaktan niya ako kapag nagsumbong ako, pero hindi niya ako hinawakan.'],
  ['Threats', 'Nagpanghulga siya nga bunalan ko kung mosumbong apan wala ko niya hilabti.'],
  ['Cyberbullying', 'An anonymous account keeps posting insults and photos to shame me.'],
  ['Cyberbullying', 'Puro masasakit na komento ang ipinapadala nila sa group chat tungkol sa akin.'],
  ['Cyberbullying', 'Gipanglibak ko sa Messenger ug gipost ang akong litrato aron pakaulawan.'],
  ['Physical Assault', 'He struck me with a stick and left a cut on my arm.'],
  ['Physical Assault', 'Sinapak ako sa panga at dumugo ang labi ko.'],
  ['Physical Assault', 'Gisagpa ko ug gisipa sa akong kauban ug nasamdan ang akong tiil.'],
  ['Physical Assault', 'Akong gi reklamo si pangalan tungod sige siyag panumbag sa ako bisan wala nako siya gihilabtan.'],
  ['Physical Assault', 'Akong gi reklamo si pangalan tungod sige siyag panumbag sa ako bisan wala nako siya gihilabtan.'],

  // Corrected mappings: descriptions that used to land on the wrong category.
  ['Safety Rules', 'A vendor is lighting firecrackers near the waiting shed before midnight.'],
  ['Safety Rules', 'May nagparada sa bawal na lugar kaya hindi makadaan ang ambulansya.'],
  ['Safety Rules', 'Bawal magparada sa daplin sa dalan ug gihaharang ang mga naglalakad.'],
  ['Safety Rules', 'May nagsunog ng basura kagabi at mabaho sa aming kalye.'],
  ['Damaged Infrastructures', 'The public comfort room wall was vandalized and needs repair.'],
  ['Damaged Infrastructures', 'The streetlight in front of our house has been broken for a month.'],
  ['Damaged Infrastructures', 'The drainage in our alley has been clogged for weeks and floods the street.'],
  ['Damaged Infrastructures', 'Walang tubig ang aming purok tatlong araw na.'],
  ['Threats', 'Someone is stalking my sister and waiting outside our gate.'],
  ['Threats', 'Someone keeps sending harassing calls to my phone every night.'],
  ['Threats', 'A person is harassing me with repeated calls and texts.'],
  ['Threats', 'Someone is spying on my wife and following her.'],
  ['Cyberbullying', 'Someone made a fake account to post embarrassing comments about me online.'],
  ['Physical Assault', 'Two neighbors exchanged punches near the store and one got a bruise.'],
  ['Medical Assistance', 'My grandmother fainted and we need an ambulance to take her to the health center.'],
  ['Noise Complaints', 'The neighbor keeps playing loud videoke until the early hours of the morning.'],
  ['Drug Abuse', 'There is a man using shabu in the abandoned house behind the store.'],
];

describe('triageComplaint', () => {
  it('limits AI categories to the eight approved options', () => {
    expect(CHANNELS).toEqual([
      'Safety Rules',
      'Damaged Infrastructures',
      'Medical Assistance',
      'Noise Complaints',
      'Drug Abuse',
      'Threats',
      'Cyberbullying',
      'Physical Assault',
    ]);

    for (const description of [
      'Someone stole my bicycle from in front of our house.',
      'A scammer collected money for a fake project.',
      'Two neighbors are arguing about a property boundary.',
      'A stray dog is chasing children near the school.',
    ]) {
      expect(CHANNELS).toContain(triageComplaint(description).category);
    }
  });

  it('provides guidance for every supported category', () => {
    expect(Object.keys(CATEGORY_GUIDANCE).sort()).toEqual([...CHANNELS].sort());
    expect(Object.values(CATEGORY_GUIDANCE).every((guidance) => guidance.trim().length > 0)).toBe(true);
  });

  it('provides a priority and staff role for every supported category', () => {
    expect(Object.keys(CATEGORY_PRIORITY).sort()).toEqual([...CHANNELS].sort());
    expect(Object.keys(CHANNEL_ROLE_MAP).sort()).toEqual([...CHANNELS].sort());
    expect(Object.values(CATEGORY_PRIORITY).every((priority) => ['LOW', 'MEDIUM', 'HIGH'].includes(priority))).toBe(true);
    expect(Object.values(CHANNEL_ROLE_MAP).every((role) => ['TANOD', 'LUPON', 'OFFICIAL'].includes(role))).toBe(true);
  });

  it('returns the mapped priority, role, and alias for every supported category', () => {
    for (const channel of CHANNELS) {
      const example = TRIAGE_TRAINING_DATA.find((entry) => entry.channel === channel);
      const result = triageComplaint(example.text);

      expect(result.channel).toBe(channel);
      expect(result.category).toBe(channel);
      expect(result.priority).toBe(CATEGORY_PRIORITY[channel]);
      expect(result.suggestedRole).toBe(CHANNEL_ROLE_MAP[channel]);
    }
  });

  it.each(TRIAGE_TRAINING_DATA)('matches the category for curated description: %s', ({ channel, text }) => {
    expect(triageComplaint(text).channel).toBe(channel);
  });

  it.each(classificationExamples)('classifies as %s: %s', (expected, description) => {
    const result = triageComplaint(description);

    expect(result.channel).toBe(expected);
    expect(result.category).toBe(expected);
  });

  it('distinguishes threats without physical attacks from actual assaults', () => {
    const threat = triageComplaint('My neighbor threatened to punch me but never touched or hit me.');
    const assault = triageComplaint('My neighbor punched me in the face and caused an injury.');

    expect(threat.channel).toBe('Threats');
    expect(assault.channel).toBe('Physical Assault');
  });

  it('prioritizes explicit safety-rule violations over incidental assault language', () => {
    const result = triageComplaint(
      'I report safety-rule violations: residents are assaulting anyone who asks them to comply.'
    );

    expect(result.channel).toBe('Safety Rules');
    expect(result.category).toBe('Safety Rules');
  });

  it('prioritizes explicit medical-care needs over incidental assault language', () => {
    const result = triageComplaint('A man attacked me and I need to go to the hospital.');

    expect(result.channel).toBe('Medical Assistance');
    expect(result.category).toBe('Medical Assistance');
  });

  it('does not treat an ambulance route violation as a medical request', () => {
    const result = triageComplaint(
      'May mga sasakyan na humaharang sa fire exit at daanan ng ambulansya.'
    );

    expect(result.channel).toBe('Safety Rules');
  });

  it('does not treat illegal medicine sales as a medical request', () => {
    const result = triageComplaint(
      'Naa koy nakita nga namaligya og ilegal nga tambal sa luyo sa covered court.'
    );

    expect(result.channel).toBe('Drug Abuse');
  });

  it('classifies a suspected drug-related activity as Drug Abuse despite general safety wording', () => {
    const result = triageComplaint(
      'I would like to report a suspected drug-related activity in our community. The reported activity may pose a threat to the safety and well-being of residents. I request that the barangay authorities investigate the matter and take appropriate action.'
    );

    expect(result.channel).toBe('Drug Abuse');
    expect(result.category).toBe('Drug Abuse');
  });

  it('does not classify a nearby hospital as a request for medical assistance', () => {
    const result = triageComplaint('The drainage is clogged near the hospital after heavy rain.');

    expect(result.channel).toBe('Damaged Infrastructures');
  });

  it('keeps an assault without an explicit medical-care need as Physical Assault', () => {
    const result = triageComplaint('A man punched me in the face and caused bruises.');

    expect(result.channel).toBe('Physical Assault');
  });

  it('uses the description as the sole classification signal', () => {
    const withoutAddress = triageComplaint('My neighbor was punched during a fight.');
    const withAddress = triageComplaint('My neighbor was punched during a fight.', 'Purok 3, near the hospital');

    expect(withoutAddress.channel).toBe('Physical Assault');
    expect(withAddress.channel).toBe(withoutAddress.channel);
    expect(withAddress.confidence).toBe(withoutAddress.confidence);
  });

  it('flags low-confidence complaints for human review', () => {
    const result = triageComplaint('Hello po.');

    expect(result.needsReview).toBe(true);
    expect(result.suggestedRole).toBeTruthy();
  });

  it('detects English, Tagalog, Bisaya, and unknown text', () => {
    expect(detectLanguage('There is a drunk person threatening neighbors.')).toBe('en');
    expect(detectLanguage('May nananakot sa amin dito.')).toBe('tl');
    expect(detectLanguage('Panumbag siya bisan wala nako siya gihilabtan.')).toBe('ceb');
    expect(detectLanguage('Hello po.')).toBe('mixed');
  });
});

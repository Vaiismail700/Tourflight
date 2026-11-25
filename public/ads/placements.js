// Edit top, left, right and popup separately. Use [] to hide a banner.
window.TF_ADS = {
  popup: {
    enabled: true,
    title: '',
    text: '',
    // Add placement objects here when you have a campaign.
    ads: []
  },
  top: [
{id:'demo1',tag:'Ad',title:'Your ad could be here',text:'Reach travellers who are searching for flights right now.',cta:'Advertise with us',url:'mailto:ismailtasheel4@gmail.com?subject=Advertise%20on%20Tourflight',img:''},
{id:'demo2',tag:'Ad',title:'Sample sponsored offer (demo)',text:'Hotels, visas, SIM cards or insurance: any travel brand can appear in this space.',cta:'Learn more',url:'/about.html',img:''}
],
  left: [
    { id: 'left-slot', tag: 'Ad', title: 'Advertise on Tourflight', text: 'Desktop left placement', cta: 'Contact us', url: '/about.html', img: '' }
  ],
  right: [
    { id: 'right-slot', tag: 'Ad', title: 'Advertise on Tourflight', text: 'Desktop right placement', cta: 'Contact us', url: '/about.html', img: '' }
  ]
};

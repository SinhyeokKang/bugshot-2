# Pick an Element

🌐 [한국어](https://bugshot.gitbook.io/ko/element/picker)

## Start picking

![Picker crosshair](../assets/element-picker-1.jpg)

In the **Debug** tab, click **Edit element style**. A crosshair appears over the page, and the element under your cursor lights up.

> Just want a screenshot of the element without touching its styles? [Capture element](../screenshot/capture.md) is the quicker route.

## Click an element

Click the element you want to select it. Its details show up in the side panel.

## Move through the DOM tree

![DOM tree navigation](../assets/element-picker-2.jpg)

Can't quite land on the exact element? No problem — you can **move to its parent or child** from the current selection. Step up (parent) or down (child) until you hit the right one.

Want to start over? **Pick another element** lets you begin fresh anytime.

## iframe limitation

Elements **inside an iframe** (a frame holding another document) **can't be selected**. Click the iframe box itself and a notice appears, cancelling the pick.

> If you really need an element inside an iframe, try [Screenshot](../screenshot/capture.md) or [Recording](../video/record.md) instead.

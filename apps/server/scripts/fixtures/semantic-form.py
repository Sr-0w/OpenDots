"""Real GTK/AT-SPI fixture, run only inside the test bot desktop."""
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib, Gdk
from pathlib import Path
import json

GLib.set_prgname('opendots-semantic-fixture')
window = Gtk.Window(title='OpenDots semantic fixture')
window.set_default_size(550, 260)
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
window.add(box)
first = Gtk.Entry()
first.get_accessible().set_name('Nom de test')
password = Gtk.Entry()
password.set_visibility(False)
password.get_accessible().set_name('Mot de passe de test')
button = Gtk.Button(label='Enregistrer le formulaire')
for widget in (first, password, button):
    box.pack_start(widget, False, False, 0)
    widget.add_events(Gdk.EventMask.POINTER_MOTION_MASK)
    widget.connect('motion-notify-event', lambda target, event: (Path.home() / 'semantic-hover.json').write_text(json.dumps({'name': target.get_accessible().get_name(), 'x': event.x_root, 'y': event.y_root})) and False)
button.connect('clicked', lambda *_: (Path.home() / 'semantic-submitted.json').write_text(json.dumps({'name': first.get_text(), 'password': password.get_text()})))
window.connect('destroy', Gtk.main_quit)
window.show_all()
Gtk.main()
